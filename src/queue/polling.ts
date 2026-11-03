import { Logger } from '@nestjs/common';
import { isString } from 'class-validator';

/** Repeats a cycle on an interval, skipping a tick while the previous cycle is still running. */
export class PollingLoop {
  private timer?: NodeJS.Timeout;
  private currentCycle?: Promise<unknown>;

  constructor(
    private readonly cycle: () => Promise<unknown>,
    private readonly logger: Logger,
    private readonly intervalMs: number,
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
        .catch((error) => this.logger.error({ event: 'polling.cycle_failed', error: errorMessage(error) }))
        .finally(() => (this.currentCycle = undefined));
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.currentCycle;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Correlates a message with its NFe in the logs, without exposing the rest of the payload. */
export function accessKeyOf(payload: unknown): string | undefined {
  const accessKey = (payload as { accessKey?: unknown } | null)?.accessKey;
  return isString(accessKey) ? accessKey : undefined;
}
