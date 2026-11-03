import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { addToOutbox } from '../queue/outbox-relay';
import { errorMessage } from '../queue/polling';
import { EnrichmentRequest, TOPIC_ENRICHMENT } from './contracts';
import { Nfe } from './nfe.entity';

@Injectable()
export class NfesService {
  private readonly logger = new Logger(NfesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Nfe) private readonly nfes: Repository<Nfe>,
  ) {}

  /** Stores the NFe and its outbound message atomically. A repeated key changes nothing. */
  async create(accessKey: string): Promise<{ nfe: Nfe; created: boolean }> {
    try {
      const created = await this.dataSource.transaction(async (manager) => {
        const inserted: Array<{ id: string }> = await manager.query(
          `INSERT INTO nfes (id, access_key) VALUES ($1, $2)
           ON CONFLICT (access_key) DO NOTHING
           RETURNING id`,
          [randomUUID(), accessKey],
        );
        if (inserted.length === 0) {
          return false;
        }
        const request: EnrichmentRequest = { nfeId: inserted[0].id, accessKey };
        await addToOutbox(manager, TOPIC_ENRICHMENT, request);
        return true;
      });
      return { nfe: await this.nfes.findOneByOrFail({ accessKey }), created };
    } catch (error) {
      this.logger.error(`Failed to store the NFe: ${errorMessage(error)}`);
      throw new ServiceUnavailableException('Could not store the NFe. Please try again.');
    }
  }

  find(id: string): Promise<Nfe | null> {
    return this.nfes.findOneBy({ id });
  }
}
