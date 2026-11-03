import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { MessageBus } from '../queue/message-bus';
import { addToOutbox } from '../queue/outbox-relay';
import { errorMessage } from '../queue/polling';
import { EnrichmentRequest, EnrichmentResult, TOPIC_ENRICHMENT, TOPIC_RESULT } from './contracts';
import { Nfe } from './nfe.entity';

@Injectable()
export class NfesService {
  private readonly logger = new Logger(NfesService.name);

  constructor(
    private readonly bus: MessageBus,
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
      const nfe = await this.nfes.findOneByOrFail({ accessKey });
      this.logger.log({ event: created ? 'nfe.created' : 'nfe.duplicate_request', nfeId: nfe.id, accessKey });
      return { nfe, created };
    } catch (error) {
      this.logger.error({ event: 'nfe.create_failed', accessKey, error: errorMessage(error) });
      throw new ServiceUnavailableException('Could not store the NFe. Please try again.');
    }
  }

  async receiveResult(result: EnrichmentResult): Promise<void> {
    try {
      await this.bus.publish(TOPIC_RESULT, result);
      this.logger.log({ event: 'result.received', accessKey: result.accessKey });
    } catch (error) {
      this.logger.error({ event: 'result.publish_failed', accessKey: result.accessKey, error: errorMessage(error) });
      throw new ServiceUnavailableException('Could not publish the message. Please try again.');
    }
  }

  find(id: string): Promise<Nfe | null> {
    return this.nfes.findOneBy({ id });
  }
}
