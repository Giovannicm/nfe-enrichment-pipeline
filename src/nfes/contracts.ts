export const TOPIC_ENRICHMENT = 'nfe.enrichment.requested';
export const TOPIC_RESULT = 'nfe.enrichment.result';

/** Outbound message. */
export interface EnrichmentRequest {
  nfeId: string;
  accessKey: string;
}

/** Inbound message. Only the key is guaranteed: the rest may be missing or invalid. */
export interface EnrichmentResult {
  accessKey: string;
  cnpj?: unknown;
  amount?: unknown;
  issueDate?: unknown;
  cancelled?: unknown;
}

export const ACCESS_KEY_PATTERN = /^\d{44}$/;

export function isValidAccessKey(key: unknown): key is string {
  return typeof key === 'string' && ACCESS_KEY_PATTERN.test(key);
}
