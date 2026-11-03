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

export function isValidAccessKey(key: unknown): key is string {
  return typeof key === 'string' && /^\d{44}$/.test(key);
}
