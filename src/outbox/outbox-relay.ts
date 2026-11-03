import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { numericEnv } from '../config';
import { MessageBus } from '../queue/message-bus';
import { accessKeyOf, errorMessage, PollingLoop } from '../queue/polling';
import { OutboxEntry } from './outbox-entry.entity';

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly polling = new PollingLoop(
    () => this.runCycle(),
    this.logger,
    numericEnv('OUTBOX_RELAY_INTERVAL_MS', 5000, 1),
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OutboxEntry) private readonly entries: Repository<OutboxEntry>,
    private readonly bus: MessageBus,
  ) {}

  onApplicationBootstrap(): void {
    this.polling.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.polling.stop();
  }

  /** Tries each pending entry once. A failed entry stays pending for the next cycle, without limit. */
  async runCycle(): Promise<number> {
    const attempted: string[] = [];
    for (;;) {
      const id = await this.publishNext(attempted);
      if (id === null) {
        return attempted.length;
      }
      attempted.push(id);
    }
  }

  private async publishNext(skip: string[]): Promise<string | null> {
    // Assigned inside the transaction callback; the cast keeps TypeScript from narrowing it to null.
    let entry = null as OutboxEntry | null;
    try {
      await this.dataSource.transaction(async (manager) => {
        const entries = manager.withRepository(this.entries);
        const where: FindOptionsWhere<OutboxEntry> = { publishedAt: IsNull() };
        if (skip.length > 0) {
          where.id = Not(In(skip));
        }
        entry = await entries.findOne({
          where,
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
        });
        if (!entry) {
          return;
        }

        await this.bus.publish(entry.topic, entry.payload, manager);

        await entries.save({ id: entry.id, publishedAt: new Date(), attempts: entry.attempts + 1 });
      });
      if (entry) {
        this.logger.log({ event: 'outbox.published', ...this.describe(entry) });
      }
    } catch (error) {
      if (!entry) {
        throw error;
      }
      this.logger.warn({ event: 'outbox.publish_failed', ...this.describe(entry), error: errorMessage(error) });
      await this.entries.save({ id: entry.id, attempts: entry.attempts + 1, lastError: errorMessage(error) });
    }
    return entry ? entry.id : null;
  }

  private describe(entry: OutboxEntry): object {
    return {
      entryId: entry.id,
      topic: entry.topic,
      accessKey: accessKeyOf(entry.payload),
      attempt: entry.attempts + 1,
    };
  }
}
