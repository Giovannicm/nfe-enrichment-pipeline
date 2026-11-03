import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { isObject, validateSync } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ProviderClient } from '../provider/provider.client';
import { CommittedLog, InvalidMessageError, QueueWorker } from '../queue/queue-worker';
import { EnrichmentRequest, EnrichmentResult, TOPIC_ENRICHMENT, TOPIC_RESULT } from './contracts';
import { evaluateResult } from './evaluate-result';
import { Nfe } from './nfe.entity';
import { EnrichmentRequestDto, EnrichmentResultDto } from './nfes.dto';

@Injectable()
export class NfesConsumers implements OnModuleInit {
  private readonly logger = new Logger(NfesConsumers.name);

  constructor(
    private readonly worker: QueueWorker,
    private readonly provider: ProviderClient,
    @InjectRepository(Nfe) private readonly nfes: Repository<Nfe>,
  ) {}

  onModuleInit(): void {
    this.worker.register(TOPIC_ENRICHMENT, (payload) => this.callProvider(payload));
    this.worker.register(TOPIC_RESULT, (payload, manager) => this.applyResult(payload, manager));
  }

  private async callProvider(payload: unknown): Promise<void> {
    const request = readRequest(payload);
    await this.provider.requestEnrichment(request);
    this.logger.log({ event: 'provider.enrichment_requested', ...request });
  }

  private async applyResult(payload: unknown, manager: EntityManager): Promise<CommittedLog> {
    const result = readResult(payload);
    const { accessKey } = result;
    const nfes = manager.withRepository(this.nfes);
    // The lock makes concurrent deliveries of a result wait, so the NFe is decided only once.
    const nfe = await nfes.findOne({ where: { accessKey }, lock: { mode: 'pessimistic_write' } });
    if (!nfe) {
      return { event: 'result.ignored_unknown_key', accessKey };
    }
    if (nfe.status !== 'ANALISE') {
      return { event: 'result.ignored_already_decided', nfeId: nfe.id, accessKey, currentStatus: nfe.status };
    }

    const evaluation = evaluateResult(result);
    const decidedAt = new Date();
    await nfes.save({
      id: nfe.id,
      status: evaluation.status,
      cnpj: evaluation.cnpj,
      amount: evaluation.amount,
      issueDate: evaluation.issueDate === null ? null : new Date(evaluation.issueDate),
      cancelled: evaluation.cancelled,
      rejectionReason: evaluation.reason,
      approvedAt: evaluation.status === 'APROVADA' ? decidedAt : null,
      updatedAt: decidedAt,
    });
    const nfeId = nfe.id;
    return evaluation.status === 'APROVADA'
      ? { event: 'nfe.approved', nfeId, accessKey }
      : { event: 'nfe.rejected', nfeId, accessKey, reason: evaluation.reason };
  }
}

function readRequest(payload: unknown): EnrichmentRequest {
  const { nfeId, accessKey } = readMessage(EnrichmentRequestDto, payload);
  return { nfeId, accessKey };
}

function readResult(payload: unknown): EnrichmentResult {
  return readMessage(EnrichmentResultDto, payload);
}

/** A message that breaks its contract can never be processed, so it goes straight to DEAD. */
function readMessage<T extends object>(type: ClassConstructor<T>, payload: unknown): T {
  if (!isObject(payload)) {
    throw new InvalidMessageError('Message breaks the contract: payload is not an object');
  }
  const message = plainToInstance(type, payload);
  const errors = validateSync(message);
  if (errors.length > 0) {
    throw new InvalidMessageError(
      `Message breaks the contract: invalid ${errors.map((error) => error.property).join(', ')}`,
    );
  }
  return message;
}
