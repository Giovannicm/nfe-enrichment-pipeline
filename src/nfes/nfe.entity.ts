import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type NfeStatus = 'ANALISE' | 'APROVADA' | 'REJEITADA';

@Entity('nfes')
export class Nfe {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'access_key', type: 'char', length: 44 })
  accessKey!: string;

  @Column({ type: 'text' })
  status!: NfeStatus;

  @Column({ type: 'text', nullable: true })
  cnpj!: string | null;

  @Column({ type: 'numeric', precision: 15, scale: 2, nullable: true })
  amount!: string | null;

  @Column({ name: 'issue_date', type: 'timestamptz', nullable: true })
  issueDate!: Date | null;

  @Column({ type: 'boolean', nullable: true })
  cancelled!: boolean | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
