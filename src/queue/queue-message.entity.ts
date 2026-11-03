import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type QueueMessageStatus = 'PENDING' | 'PROCESSED' | 'DEAD';

@Entity('queue_messages')
export class QueueMessage {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  topic!: string;

  @Column({ type: 'jsonb' })
  payload!: unknown;

  @Column({ type: 'text', default: 'PENDING' })
  status!: QueueMessageStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'available_at', type: 'timestamptz' })
  availableAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}
