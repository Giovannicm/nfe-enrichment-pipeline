import { formatEvent } from './event-console-logger';

describe('formatEvent', () => {
  it('prints the event followed by its fields', () => {
    expect(formatEvent({ event: 'http.request', method: 'POST', status: 201, durationMs: 7 })).toBe(
      'http.request method=POST status=201 durationMs=7',
    );
  });

  it('quotes values with spaces', () => {
    expect(formatEvent({ event: 'nfe.rejected', reason: 'Missing or invalid data: cnpj' })).toBe(
      'nfe.rejected reason="Missing or invalid data: cnpj"',
    );
  });

  it('omits undefined fields', () => {
    expect(formatEvent({ event: 'queue.message_dead', accessKey: undefined, attempt: 1 })).toBe(
      'queue.message_dead attempt=1',
    );
  });
});
