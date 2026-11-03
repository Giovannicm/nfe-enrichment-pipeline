import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEntry } from './outbox-entry.entity';

@Injectable()
export class Outbox {
  constructor(@InjectRepository(OutboxEntry) private readonly entries: Repository<OutboxEntry>) {}

  /** Records a message to publish later. Must run in the same transaction as the data it refers to. */
  async add(manager: EntityManager, topic: string, payload: object): Promise<void> {
    const entries = manager.withRepository(this.entries);
    await entries.save(entries.create({ topic, payload }));
  }
}
