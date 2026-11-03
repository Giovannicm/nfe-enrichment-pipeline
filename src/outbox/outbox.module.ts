import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueModule } from '../queue/queue.module';
import { Outbox } from './outbox';
import { OutboxEntry } from './outbox-entry.entity';
import { OutboxRelay } from './outbox-relay';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEntry]), QueueModule],
  providers: [Outbox, OutboxRelay],
  exports: [Outbox],
})
export class OutboxModule {}
