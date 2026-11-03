import { Module } from '@nestjs/common';
import { MessageBus, TableMessageBus } from './message-bus';
import { OutboxRelay } from './outbox-relay';
import { QueueWorker } from './queue-worker';

@Module({
  providers: [{ provide: MessageBus, useClass: TableMessageBus }, QueueWorker, OutboxRelay],
  exports: [MessageBus, QueueWorker],
})
export class QueueModule {}
