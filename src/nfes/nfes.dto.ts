import { Allow, Matches } from 'class-validator';
import { ACCESS_KEY_PATTERN, EnrichmentResult } from './contracts';

const ACCESS_KEY_MESSAGE = 'accessKey must have 44 numeric digits';

export class CreateNfeDto {
  @Matches(ACCESS_KEY_PATTERN, { message: ACCESS_KEY_MESSAGE })
  accessKey!: string;
}

/**
 * Only the key can be refused here. Missing or invalid data must reach the queue
 * so the NFe becomes REJEITADA with a reason: `evaluateResult` owns those rules.
 */
export class EnrichmentResultDto implements EnrichmentResult {
  @Matches(ACCESS_KEY_PATTERN, { message: ACCESS_KEY_MESSAGE })
  accessKey!: string;

  @Allow()
  cnpj?: unknown;

  @Allow()
  amount?: unknown;

  @Allow()
  issueDate?: unknown;

  @Allow()
  cancelled?: unknown;
}
''