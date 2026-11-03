import { Injectable, Logger } from '@nestjs/common';
import { EnrichmentRequest } from '../nfes/contracts';

export abstract class ProviderClient {
  abstract requestEnrichment(request: EnrichmentRequest): Promise<void>;
}

/** There is no real vendor: it logs the request, and the result arrives through the queue. */
@Injectable()
export class SimulatedProviderClient extends ProviderClient {
  private readonly logger = new Logger(SimulatedProviderClient.name);

  async requestEnrichment(request: EnrichmentRequest): Promise<void> {
    this.logger.log(`Enrichment requested: ${JSON.stringify(request)}`);
  }
}
