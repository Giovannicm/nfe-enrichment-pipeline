import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ProviderClient } from '../provider/provider.client';
import { InvalidMessageError, QueueWorker } from '../queue/queue-worker';
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
    await this.provider.requestEnrichment(readRequest(payload));
  }

  private async applyResult(payload: unknown, manager: EntityManager): Promise<void> {
    const result = readResult(payload);
    const evaluation = evaluateResult(result);
    // The ANALISE condition makes redelivery harmless, even when concurrent.
    const [, updated]: [unknown, number] = await manager.query(
      `UPDATE nfes
          SET status = $2,
              cnpj = $3,
              amount = $4,
              issue_date = $5,
              cancelled = $6,
              rejection_reason = $7,
              approved_at = CASE WHEN $2 = 'APROVADA' THEN now() END,
              updated_at = now()
        WHERE access_key = $1 AND status = 'ANALISE'`,
      [
        result.accessKey,
        evaluation.status,
        evaluation.cnpj,
        evaluation.amount,
        evaluation.issueDate,
        evaluation.cancelled,
        evaluation.reason,
      ],
    );
    if (updated === 0) {
      this.logger.log(`Result ignored, unknown key or NFe already decided: ${result.accessKey}`);
    }
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
