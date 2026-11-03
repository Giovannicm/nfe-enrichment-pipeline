import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/database.config';
import { NfesModule } from './nfes/nfes.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...databaseOptions(), migrationsRun: true }),
    }),
    NfesModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true }),
    },
  ],
})
export class AppModule {}
