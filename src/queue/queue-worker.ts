import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In, LessThanOrEqual, Not, Repository } from 'typeorm';
import { numericEnv } from '../config';
import { accessKeyOf, errorMessage, PollingLoop } from './polling';
import { QueueMessage } from './queue-message.entity';

/** A message that can never succeed: redelivering it is pointless. */
export class InvalidMessageError extends Error {}

/** What a handler reports. It is logged only after the commit, so a rollback never leaves a false entry. */
export interface CommittedLog {
  event: string;
  [field: string]: unknown;
}

export type MessageHandler = (payload: unknown, manager: EntityManager) => Promise<CommittedLog | void>;

@Injectable()
export class QueueWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueWorker.name);
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly maxAttempts = numericEnv('QUEUE_MAX_ATTEMPTS', 5, 1);
  private readonly redeliveryDelayMs = numericEnv('QUEUE_REDELIVERY_DELAY_MS', 5000);
  private readonly polling = new PollingLoop(
    () => this.runCycle(),
    this.logger,
    numericEnv('POLL_INTERVAL_MS', 1000, 1),
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(QueueMessage) private readonly messages: Repository<QueueMessage>,
  ) {}

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
    // Assigned inside the transaction callback; the cast keeps TypeScript from narrowing it to null.
    let message = null as QueueMessage | null;
    let outcome: CommittedLog | undefined;
    const startedAt = Date.now();
    try {
      await this.dataSource.transaction(async (manager) => {
        const messages = manager.withRepository(this.messages);
        const where: FindOptionsWhere<QueueMessage> = { status: 'PENDING', availableAt: LessThanOrEqual(new Date()) };
        if (skip.length > 0) {
          where.id = Not(In(skip));
        }
        message = await messages.findOne({
          where,
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
        });
        if (!message) {
          return;
        }

        const handler = this.handlers.get(message.topic);
        if (!handler) {
          throw new InvalidMessageError(`No handler for topic: ${message.topic}`);
        }
        outcome = (await handler(message.payload, manager)) ?? undefined;

        await messages.save({
          id: message.id,
          status: 'PROCESSED',
          attempts: message.attempts + 1,
          processedAt: new Date(),
        });
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
    await this.messages.save({
      id: message.id,
      status: dead ? 'DEAD' : 'PENDING',
      attempts: message.attempts + 1,
      lastError: errorMessage(error),
      availableAt: new Date(Date.now() + this.redeliveryDelayMs),
    });
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
