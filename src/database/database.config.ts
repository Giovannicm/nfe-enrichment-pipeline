import { DataSourceOptions } from 'typeorm';
import { requiredEnv } from '../config';
import { Nfe } from '../nfes/nfe.entity';
import { InitialSchema1730000000000 } from './migrations/1730000000000-initial-schema';

export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: requiredEnv('DATABASE_URL'),
    entities: [Nfe],
    migrations: [InitialSchema1730000000000],
  };
}
