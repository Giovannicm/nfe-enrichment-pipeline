import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ProviderClient } from '../provider/provider.client';
import { CommittedLog, InvalidMessageError, QueueWorker } from '../queue/queue-worker';
import { EnrichmentRequest, EnrichmentResult, isValidAccessKey, TOPIC_ENRICHMENT, TOPIC_RESULT } from './contracts';
import { evaluateResult } from './evaluate-result';

@Injectable()
export class NfesConsumers implements OnModuleInit {
  private readonly logger = new Logger(NfesConsumers.name);

  constructor(
    private readonly worker: QueueWorker,
    private readonly provider: ProviderClient,
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
    // The lock makes concurrent deliveries of a result wait, so the NFe is decided only once.
    const [nfe]: Array<{ id: string; status: string }> = await manager.query(
      'SELECT id, status FROM nfes WHERE access_key = $1 FOR UPDATE',
      [accessKey],
    );
    if (!nfe) {
      return { event: 'result.ignored_unknown_key', accessKey };
    }
    if (nfe.status !== 'ANALISE') {
      return { event: 'result.ignored_already_decided', nfeId: nfe.id, accessKey, currentStatus: nfe.status };
    }

    const evaluation = evaluateResult(result);
    await manager.query(
      `UPDATE nfes
          SET status = $2,
              cnpj = $3,
              amount = $4,
              issue_date = $5,
              cancelled = $6,
              rejection_reason = $7,
              approved_at = CASE WHEN $2 = 'APROVADA' THEN now() END,
              updated_at = now()
        WHERE id = $1`,
      [
        nfe.id,
        evaluation.status,
        evaluation.cnpj,
        evaluation.amount,
        evaluation.issueDate,
        evaluation.cancelled,
        evaluation.reason,
      ],
    );
    const nfeId = nfe.id;
    return evaluation.status === 'APROVADA'
      ? { event: 'nfe.approved', nfeId, accessKey }
      : { event: 'nfe.rejected', nfeId, accessKey, reason: evaluation.reason };
  }
}

function readRequest(payload: unknown): EnrichmentRequest {
  const { nfeId, accessKey } = (payload ?? {}) as Partial<EnrichmentRequest>;
  if (typeof nfeId !== 'string' || !isValidAccessKey(accessKey)) {
    throw new InvalidMessageError('Message breaks the contract: invalid nfeId or accessKey');
  }
  return { nfeId, accessKey };
}

function readResult(payload: unknown): EnrichmentResult {
  if (!isValidAccessKey((payload as Partial<EnrichmentResult> | null)?.accessKey)) {
    throw new InvalidMessageError('Message breaks the contract: invalid accessKey');
  }
  return payload as EnrichmentResult;
}
