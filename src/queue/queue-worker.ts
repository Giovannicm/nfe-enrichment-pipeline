import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { numericEnv } from '../config';
import { accessKeyOf, errorMessage, PollingLoop } from './polling';

/** A message that can never succeed: redelivering it is pointless. */
export class InvalidMessageError extends Error {}

/** What a handler reports. It is logged only after the commit, so a rollback never leaves a false entry. */
export interface CommittedLog {
  event: string;
  [field: string]: unknown;
}

export type MessageHandler = (payload: unknown, manager: EntityManager) => Promise<CommittedLog | void>;

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
  private readonly maxAttempts = numericEnv('QUEUE_MAX_ATTEMPTS', 5, 1);
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
    let outcome: CommittedLog | undefined;
    const startedAt = Date.now();
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
        outcome = (await handler(next.payload, manager)) ?? undefined;

        await manager.query(
          `UPDATE queue_messages
              SET status = 'PROCESSED', attempts = attempts + 1, processed_at = now()
            WHERE id = $1`,
          [next.id],
        );
      });
      if (message) {
        if (outcome) {
          this.logger.log(outcome);
        }
        this.logger.log({ event: 'queue.message_processed', ...describe(message), durationMs: Date.now() - startedAt });
      }
    } catch (error) {
      if (!message) {
        throw error;
      }
      await this.recordFailure(message, error, Date.now() - startedAt);
    }
    return message ? message.id : null;
  }

  private async recordFailure(message: QueueMessage, error: unknown, durationMs: number): Promise<void> {
    const dead = error instanceof InvalidMessageError || message.attempts + 1 >= this.maxAttempts;
    const entry = { ...describe(message), maxAttempts: this.maxAttempts, durationMs, error: errorMessage(error) };
    if (dead) {
      this.logger.error({ event: 'queue.message_dead', ...entry });
    } else {
      this.logger.warn({ event: 'queue.message_failed', ...entry, retryInMs: this.redeliveryDelayMs });
    }
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

function describe(message: QueueMessage): object {
  return {
    messageId: message.id,
    topic: message.topic,
    accessKey: accessKeyOf(message.payload),
    attempt: message.attempts + 1,
  };
}
