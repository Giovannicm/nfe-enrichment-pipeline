import { EnrichmentRequest } from '../../src/nfes/contracts';
import { ProviderClient } from '../../src/provider/provider.client';

/** Records received requests and can simulate provider downtime. */
export class FakeProvider extends ProviderClient {
  requests: EnrichmentRequest[] = [];
  remainingFailures = 0;

  async requestEnrichment(request: EnrichmentRequest): Promise<void> {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error('Provider unavailable');
    }
    this.requests.push(request);
  }

  reset(): void {
    this.requests = [];
    this.remainingFailures = 0;
  }
}
