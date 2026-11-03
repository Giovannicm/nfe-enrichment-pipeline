import { Logger } from '@nestjs/common';
import { PollingLoop } from './polling';

describe('PollingLoop', () => {
  const backgroundJobs = process.env.BACKGROUND_JOBS_ENABLED;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.BACKGROUND_JOBS_ENABLED = 'true';
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.BACKGROUND_JOBS_ENABLED = backgroundJobs;
  });

  it('runs the cycle at the given interval', async () => {
    const cycle = jest.fn().mockResolvedValue(0);
    const loop = new PollingLoop(cycle, new Logger(), 5000);

    loop.start();
    await jest.advanceTimersByTimeAsync(4999);
    expect(cycle).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5000);
    expect(cycle).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it('does not start when background jobs are disabled', async () => {
    process.env.BACKGROUND_JOBS_ENABLED = 'false';
    const cycle = jest.fn().mockResolvedValue(0);
    const loop = new PollingLoop(cycle, new Logger(), 1000);

    loop.start();
    await jest.advanceTimersByTimeAsync(5000);

    expect(cycle).not.toHaveBeenCalled();
    await loop.stop();
  });
});
