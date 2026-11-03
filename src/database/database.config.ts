import { DataSourceOptions } from 'typeorm';
import { requiredEnv } from '../config';
import { Nfe } from '../nfes/nfe.entity';
import { OutboxEntry } from '../outbox/outbox-entry.entity';
import { QueueMessage } from '../queue/queue-message.entity';
import { InitialSchema1730000000000 } from './migrations/1730000000000-initial-schema';

export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: requiredEnv('DATABASE_URL'),
    entities: [Nfe, OutboxEntry, QueueMessage],
    migrations: [InitialSchema1730000000000],
  };
}
