import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { MessageBus } from './message-bus';
import { accessKeyOf, errorMessage, PollingLoop } from './polling';

interface OutboxEntry {
  id: string;
  topic: string;
  payload: object;
  attempts: number;
}

/** Records a message to publish later. Must run in the same transaction as the data it refers to. */
export async function addToOutbox(manager: EntityManager, topic: string, payload: object): Promise<void> {
  await manager.query('INSERT INTO outbox (topic, payload) VALUES ($1, $2)', [topic, JSON.stringify(payload)]);
}

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly polling = new PollingLoop(() => this.runCycle(), this.logger);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
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
    let entry: OutboxEntry | undefined;
    try {
      await this.dataSource.transaction(async (manager) => {
        const [next]: OutboxEntry[] = await manager.query(
          `SELECT id, topic, payload, attempts
             FROM outbox
            WHERE published_at IS NULL
              AND NOT (id = ANY($1::bigint[]))
            ORDER BY id
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [skip],
        );
        if (!next) {
          return;
        }
        entry = next;

        await this.bus.publish(next.topic, next.payload, manager);

        await manager.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1', [next.id]);
      });
      if (entry) {
        this.logger.log({ event: 'outbox.published', ...this.describe(entry) });
      }
    } catch (error) {
      if (!entry) {
        throw error;
      }
      this.logger.warn({ event: 'outbox.publish_failed', ...this.describe(entry), error: errorMessage(error) });
      await this.dataSource.query('UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [
        entry.id,
        errorMessage(error),
      ]);
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
