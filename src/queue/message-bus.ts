import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

export abstract class MessageBus {
  /** With `manager`, publishing joins the caller's transaction. */
  abstract publish(topic: string, payload: object, manager?: EntityManager): Promise<void>;
}

@Injectable()
export class TableMessageBus extends MessageBus {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async publish(topic: string, payload: object, manager?: EntityManager): Promise<void> {
    await (manager ?? this.dataSource.manager).query('INSERT INTO queue_messages (topic, payload) VALUES ($1, $2)', [
      topic,
      JSON.stringify(payload),
    ]);
  }
}
