import { Logger } from '@nestjs/common';
import { numericEnv } from '../config';

/** Repeats a cycle on an interval, skipping a tick while the previous cycle is still running. */
export class PollingLoop {
  private timer?: NodeJS.Timeout;
  private currentCycle?: Promise<unknown>;

  constructor(
    private readonly cycle: () => Promise<unknown>,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (process.env.BACKGROUND_JOBS_ENABLED === 'false') {
      return;
    }
    this.timer = setInterval(() => {
      if (this.currentCycle) {
        return;
      }
      this.currentCycle = this.cycle()
        .catch((error) => this.logger.error(`Cycle failed: ${errorMessage(error)}`))
        .finally(() => (this.currentCycle = undefined));
    }, numericEnv('POLL_INTERVAL_MS', 1000));
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.currentCycle;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
