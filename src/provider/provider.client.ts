import { Injectable } from '@nestjs/common';
import { EnrichmentRequest } from '../nfes/contracts';

export abstract class ProviderClient {
  abstract requestEnrichment(request: EnrichmentRequest): Promise<void>;
}

/** There is no real vendor: the request goes nowhere, and the result arrives through the webhook. */
@Injectable()
export class SimulatedProviderClient extends ProviderClient {
  async requestEnrichment(): Promise<void> {}
}
