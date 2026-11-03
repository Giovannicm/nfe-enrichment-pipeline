import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database.config';

describe('Migrations', () => {
  const dataSource = new DataSource(databaseOptions());

  const tables = async (): Promise<string[]> => {
    const rows: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations' ORDER BY tablename`,
    );
    return rows.map((row) => row.tablename);
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
