import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1730000000000 implements MigrationInterface {
  name = 'InitialSchema1730000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE nfes (
        id uuid PRIMARY KEY,
        access_key char(44) NOT NULL UNIQUE CHECK (access_key ~ '^[0-9]{44}$'),
        status text NOT NULL DEFAULT 'ANALISE' CHECK (status IN ('ANALISE', 'APROVADA', 'REJEITADA')),
        cnpj text,
        amount numeric(15, 2),
        issue_date timestamptz,
        cancelled boolean,
        rejection_reason text,
        approved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT approved_at_only_when_approved CHECK ((status = 'APROVADA') = (approved_at IS NOT NULL)),
        CONSTRAINT reason_only_when_rejected CHECK ((status = 'REJEITADA') = (rejection_reason IS NOT NULL)),
        CONSTRAINT approved_requires_complete_data CHECK (
          status <> 'APROVADA'
          OR (cnpj IS NOT NULL AND amount IS NOT NULL AND issue_date IS NOT NULL AND cancelled = false)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE outbox (
        id bigserial PRIMARY KEY,
        topic text NOT NULL,
        payload jsonb NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE INDEX outbox_pending ON outbox (id) WHERE published_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE queue_messages (
        id bigserial PRIMARY KEY,
        topic text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'DEAD')),
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        available_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE INDEX queue_messages_pending ON queue_messages (available_at, id) WHERE status = 'PENDING'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE queue_messages');
    await queryRunner.query('DROP TABLE outbox');
    await queryRunner.query('DROP TABLE nfes');
  }
}
