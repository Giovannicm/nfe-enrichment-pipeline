import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database.config';

describe('Migrations', () => {
  const dataSource = new DataSource(databaseOptions());

  /** Application tables that exist right now, read through the TypeORM query runner. */
  const tables = async (): Promise<string[]> => {
    const queryRunner = dataSource.createQueryRunner();
    try {
      const existing: string[] = [];
      for (const table of ['nfes', 'outbox', 'queue_messages']) {
        if (await queryRunner.hasTable(table)) {
          existing.push(table);
        }
      }
      return existing;
    } finally {
      await queryRunner.release();
    }
  };

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('reverts and reapplies the schema', async () => {
    expect(await tables()).toEqual(['nfes', 'outbox', 'queue_messages']);

    await dataSource.undoLastMigration();
    expect(await tables()).toEqual([]);

    await dataSource.runMigrations();
    expect(await tables()).toEqual(['nfes', 'outbox', 'queue_messages']);
  });
});
