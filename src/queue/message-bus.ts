import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { QueueMessage } from './queue-message.entity';

export abstract class MessageBus {
  /** With `manager`, publishing joins the caller's transaction. */
  abstract publish(topic: string, payload: object, manager?: EntityManager): Promise<void>;
}

@Injectable()
export class TableMessageBus extends MessageBus {
  constructor(@InjectRepository(QueueMessage) private readonly messages: Repository<QueueMessage>) {
    super();
  }

  async publish(topic: string, payload: object, manager?: EntityManager): Promise<void> {
    const messages = manager ? manager.withRepository(this.messages) : this.messages;
    await messages.save(messages.create({ topic, payload, availableAt: new Date() }));
  }
}
