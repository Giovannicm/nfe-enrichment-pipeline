import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { numericEnv } from '../config';
import { errorMessage, PollingLoop } from './polling';

/** A message that can never succeed: redelivering it is pointless. */
export class InvalidMessageError extends Error {}

export type MessageHandler = (payload: unknown, manager: EntityManager) => Promise<void>;

interface QueueMessage {
  id: string;
  topic: string;
  payload: unknown;
  attempts: number;
}

@Injectable()
export class QueueWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueWorker.name);
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly maxAttempts = numericEnv('QUEUE_MAX_ATTEMPTS', 5);
  private readonly redeliveryDelayMs = numericEnv('QUEUE_REDELIVERY_DELAY_MS', 5000);
  private readonly polling = new PollingLoop(() => this.runCycle(), this.logger);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  register(topic: string, handler: MessageHandler): void {
    this.handlers.set(topic, handler);
  }

  onApplicationBootstrap(): void {
    this.polling.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.polling.stop();
  }

  /**
   * Processes the available messages, each at most once per cycle.
   * Messages published during the cycle join the same cycle.
   */
  async runCycle(): Promise<number> {
    const attempted: string[] = [];
    for (;;) {
      const id = await this.processNext(attempted);
      if (id === null) {
        return attempted.length;
      }
      attempted.push(id);
    }
  }

  private async processNext(skip: string[]): Promise<string | null> {
    let message: QueueMessage | undefined;
    try {
      await this.dataSource.transaction(async (manager) => {
        const [next]: QueueMessage[] = await manager.query(
          `SELECT id, topic, payload, attempts
             FROM queue_messages
            WHERE status = 'PENDING'
              AND available_at <= now()
              AND NOT (id = ANY($1::bigint[]))
            ORDER BY id
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [skip],
        );
        if (!next) {
          return;
        }
        message = next;

        const handler = this.handlers.get(next.topic);
        if (!handler) {
          throw new InvalidMessageError(`No handler for topic: ${next.topic}`);
        }
        await handler(next.payload, manager);

        await manager.query(
          `UPDATE queue_messages
              SET status = 'PROCESSED', attempts = attempts + 1, processed_at = now()
            WHERE id = $1`,
          [next.id],
        );
      });
    } catch (error) {
      if (!message) {
        throw error;
      }
      await this.recordFailure(message, error);
    }
    return message ? message.id : null;
  }

  private async recordFailure(message: QueueMessage, error: unknown): Promise<void> {
    const dead = error instanceof InvalidMessageError || message.attempts + 1 >= this.maxAttempts;
    this.logger.warn(
      `Message ${message.id} (${message.topic}) failed, ${dead ? 'marked as DEAD' : 'will be redelivered'}: ${errorMessage(error)}`,
    );
    await this.dataSource.query(
      `UPDATE queue_messages
          SET status = $2,
              attempts = attempts + 1,
              last_error = $3,
              available_at = now() + make_interval(secs => $4::double precision / 1000)
        WHERE id = $1`,
      [message.id, dead ? 'DEAD' : 'PENDING', errorMessage(error), this.redeliveryDelayMs],
    );
  }
}
