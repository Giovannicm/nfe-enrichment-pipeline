import { DataSource } from 'typeorm';
import { databaseOptions } from './database.config';

/** Entry point of the TypeORM CLI. The application connects through AppModule. */
export default new DataSource(databaseOptions());
