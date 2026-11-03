import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { requiredEnv } from './config';
import { InitialSchema1730000000000 } from './database/migrations/1730000000000-initial-schema';
import { Nfe } from './nfes/nfe.entity';
import { NfesModule } from './nfes/nfes.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: requiredEnv('DATABASE_URL'),
        entities: [Nfe],
        migrations: [InitialSchema1730000000000],
        migrationsRun: true,
      }),
    }),
    NfesModule,
  ],
})
export class AppModule {}
