import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
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

  /** Creates the NFe with its outbound message, or refuses with 409 when the key was already received. */
  async create(accessKey: string): Promise<Nfe> {
    const existing = await this.nfes.findOneBy({ accessKey });
    if (existing) {
      throw this.conflict(existing.id, accessKey);
    }

    const id = randomUUID();
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query('INSERT INTO nfes (id, access_key) VALUES ($1, $2)', [id, accessKey]);
        const request: EnrichmentRequest = { nfeId: id, accessKey };
        await addToOutbox(manager, TOPIC_ENRICHMENT, request);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A simultaneous request stored the same key between the lookup and the insert.
        const winner = await this.nfes.findOneByOrFail({ accessKey });
        throw this.conflict(winner.id, accessKey);
      }
      this.logger.error({ event: 'nfe.create_failed', accessKey, error: errorMessage(error) });
      throw new ServiceUnavailableException('Could not store the NFe. Please try again.');
    }

    this.logger.log({ event: 'nfe.created', nfeId: id, accessKey });
    return this.nfes.findOneByOrFail({ id });
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

  private conflict(nfeId: string, accessKey: string): ConflictException {
    this.logger.warn({ event: 'nfe.duplicate_request', nfeId, accessKey });
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'An NFe with this access key already exists',
      nfeId,
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505';
}
