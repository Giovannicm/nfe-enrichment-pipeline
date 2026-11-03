import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageBus, TableMessageBus } from './message-bus';
import { QueueMessage } from './queue-message.entity';
import { QueueWorker } from './queue-worker';

@Module({
  imports: [TypeOrmModule.forFeature([QueueMessage])],
  providers: [{ provide: MessageBus, useClass: TableMessageBus }, QueueWorker],
  exports: [MessageBus, QueueWorker],
})
export class QueueModule {}
