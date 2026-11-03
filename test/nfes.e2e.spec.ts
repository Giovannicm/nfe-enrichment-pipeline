import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TOPIC_ENRICHMENT, TOPIC_RESULT } from '../src/nfes/contracts';
import { ProviderClient } from '../src/provider/provider.client';
import { MessageBus } from '../src/queue/message-bus';
import { OutboxRelay } from '../src/queue/outbox-relay';
import { QueueWorker } from '../src/queue/queue-worker';
import { FakeProvider } from './support/fake-provider';

const ACCESS_KEY = '35261012345678000190550010000000011000000011';
const TOKEN = process.env.WEBHOOK_TOKEN as string;

const completeResult = {
  accessKey: ACCESS_KEY,
  cnpj: '12345678000190',
  amount: '1234.56',
  issueDate: '2026-10-30T12:00:00Z',
  cancelled: false,
};

describe('NFe pipeline (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let worker: QueueWorker;
  let relay: OutboxRelay;
  let bus: MessageBus;
  const provider = new FakeProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProviderClient)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.init();
    dataSource = app.get(getDataSourceToken());
    worker = app.get(QueueWorker);
    relay = app.get(OutboxRelay);
    bus = app.get(MessageBus);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE nfes, outbox, queue_messages');
    provider.reset();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const postNfe = (body: object = { accessKey: ACCESS_KEY }) => request(app.getHttpServer()).post('/nfes').send(body);

  /** The simulated provider publishes the result by calling the webhook. */
  const providerReturns = (body: object, token = TOKEN) =>
    request(app.getHttpServer()).post('/webhooks/provider').set('x-webhook-token', token).send(body);

  const getNfe = (id: string) => request(app.getHttpServer()).get(`/nfes/${id}`);

  const countNfes = async (): Promise<number> => (await dataSource.query('SELECT count(*)::int AS n FROM nfes'))[0].n;

  const outboxEntries = (): Promise<
    Array<{ topic: string; payload: object; attempts: number; last_error: string | null; published_at: Date | null }>
  > => dataSource.query('SELECT topic, payload, attempts, last_error, published_at FROM outbox ORDER BY id');

  const messages = (topic: string): Promise<Array<{ payload: object; status: string; attempts: number }>> =>
    dataSource.query('SELECT payload, status, attempts FROM queue_messages WHERE topic = $1 ORDER BY id', [topic]);

  /** Runs the background jobs: the relay publishes, then the worker consumes. */
  const runJobs = async (): Promise<void> => {
    await relay.runCycle();
    await worker.runCycle();
  };

  /** Creates the NFe and carries the request through to the provider. */
  const createNfe = async (): Promise<string> => {
    const response = await postNfe().expect(201);
    await runJobs();
    return response.body.id;
  };

  const withFailingTrigger = async (table: string, when: string, run: () => Promise<void>): Promise<void> => {
    await dataSource.query(`
      CREATE FUNCTION simulate_failure() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'simulated failure';
      END $$ LANGUAGE plpgsql
    `);
    await dataSource.query(`
      CREATE TRIGGER simulate_failure ${when} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION simulate_failure()
    `);
    try {
      await run();
    } finally {
      await dataSource.query(`DROP TRIGGER simulate_failure ON ${table}`);
      await dataSource.query('DROP FUNCTION simulate_failure');
    }
  };

  describe('creation in ANALISE and outbound message', () => {
    it('POST creates the NFe in ANALISE, without approval date, and does not call the provider', async () => {
      const response = await postNfe().expect(201);

      expect(response.body).toMatchObject({ accessKey: ACCESS_KEY, status: 'ANALISE', approvedAt: null });
      expect((await getNfe(response.body.id).expect(200)).body).toEqual(response.body);
      expect(provider.requests).toEqual([]);
    });

    it('POST records the outbound message in the outbox, with the NFe id and the access key', async () => {
      const { id } = (await postNfe().expect(201)).body;

      const entries = await outboxEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        topic: TOPIC_ENRICHMENT,
        payload: { nfeId: id, accessKey: ACCESS_KEY },
        published_at: null,
      });
      expect(await messages(TOPIC_ENRICHMENT)).toHaveLength(0);
    });

    it('the relay publishes the outbound message, and the worker delivers it to the provider', async () => {
      const { id } = (await postNfe().expect(201)).body;

      await relay.runCycle();

      expect((await outboxEntries())[0].published_at).not.toBeNull();
      const [published] = await messages(TOPIC_ENRICHMENT);
      expect(published).toMatchObject({ payload: { nfeId: id, accessKey: ACCESS_KEY }, status: 'PENDING' });
      expect(provider.requests).toEqual([]);

      await worker.runCycle();

      expect((await messages(TOPIC_ENRICHMENT))[0].status).toBe('PROCESSED');
      expect(provider.requests).toEqual([{ nfeId: id, accessKey: ACCESS_KEY }]);
    });

    it('without a provider result, the NFe stays in ANALISE', async () => {
      const id = await createNfe();
      await runJobs();

      expect((await getNfe(id)).body.status).toBe('ANALISE');
    });

    it.each([
      ['too short', '123'],
      ['not numeric', 'a'.repeat(44)],
      ['missing', undefined],
      ['a number', 123],
    ])('refuses a key that is %s, without writing', async (_description, key) => {
      await postNfe({ accessKey: key }).expect(400);

      expect(await countNfes()).toBe(0);
      expect(await outboxEntries()).toHaveLength(0);
    });

    it('refuses an array body or no body at all', async () => {
      await postNfe([{ accessKey: ACCESS_KEY }]).expect(400);
      await request(app.getHttpServer()).post('/nfes').expect(400);

      expect(await countNfes()).toBe(0);
    });

    it('explains why the key was refused', async () => {
      const response = await postNfe({ accessKey: '123' }).expect(400);

      expect(response.body.message).toEqual(['accessKey must have 44 numeric digits']);
    });

    it('ignores unknown fields', async () => {
      const response = await postNfe({ accessKey: ACCESS_KEY, status: 'APROVADA', id: 'chosen-by-client' }).expect(201);

      expect(response.body.status).toBe('ANALISE');
      expect(response.body.id).not.toBe('chosen-by-client');
    });

    it('answers 400 for a malformed id and 404 for an unknown one', async () => {
      await getNfe('not-a-uuid').expect(400);
      await getNfe('00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  describe('two requests with the same key', () => {
    it('two sequential requests create one NFe, one outbox entry and one provider call', async () => {
      const first = await postNfe().expect(201);
      await runJobs();
      const second = await postNfe().expect(200);
      await runJobs();

      expect(second.body.id).toBe(first.body.id);
      expect(await countNfes()).toBe(1);
      expect(await outboxEntries()).toHaveLength(1);
      expect(provider.requests).toHaveLength(1);
    });

    it('simultaneous requests create one NFe: one answers 201 and the others 200', async () => {
      const responses = await Promise.all([postNfe(), postNfe(), postNfe(), postNfe()]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect(await countNfes()).toBe(1);
      expect(await outboxEntries()).toHaveLength(1);

      await runJobs();
      expect(provider.requests).toHaveLength(1);
    });

    it('a second request returns an NFe already decided, without reopening it', async () => {
      const id = await createNfe();
      await providerReturns(completeResult).expect(202);
      await runJobs();
      const before = (await getNfe(id)).body;

      const second = await postNfe().expect(200);
      await runJobs();

      expect(second.body).toEqual(before);
      expect((await getNfe(id)).body).toEqual(before);
      expect(provider.requests).toHaveLength(1);
    });
  });

  describe('approval and rejection by the provider result', () => {
    it('the webhook only publishes: the NFe changes in queue processing', async () => {
      const id = await createNfe();

      await providerReturns(completeResult).expect(202);

      expect((await getNfe(id)).body.status).toBe('ANALISE');
      expect(await messages(TOPIC_RESULT)).toHaveLength(1);
    });

    it('approves after a complete result', async () => {
      const id = await createNfe();
      await providerReturns(completeResult).expect(202);
      await runJobs();

      const nfe = (await getNfe(id)).body;
      expect(nfe).toMatchObject({
        status: 'APROVADA',
        cnpj: '12345678000190',
        amount: '1234.56',
        issueDate: '2026-10-30T12:00:00.000Z',
        cancelled: false,
        rejectionReason: null,
      });
      expect(nfe.approvedAt).toEqual(expect.any(String));
    });

    it('rejects a cancelled result, stores the reason and no approval date', async () => {
      const id = await createNfe();
      await providerReturns({ ...completeResult, cancelled: true }).expect(202);
      await runJobs();

      expect((await getNfe(id)).body).toMatchObject({
        status: 'REJEITADA',
        rejectionReason: 'NFe cancelled',
        cancelled: true,
        approvedAt: null,
      });
    });

    it.each(['cnpj', 'amount', 'issueDate'])('rejects a result without %s and stores the reason', async (field) => {
      const id = await createNfe();
      await providerReturns({ ...completeResult, [field]: undefined }).expect(202);
      await runJobs();

      expect((await getNfe(id)).body).toMatchObject({
        status: 'REJEITADA',
        rejectionReason: `Missing or invalid data: ${field}`,
        approvedAt: null,
      });
    });

    it('the inbound message does not create an NFe when the key is unknown', async () => {
      await providerReturns(completeResult).expect(202);
      await runJobs();

      expect(await countNfes()).toBe(0);
      const [inbound] = await messages(TOPIC_RESULT);
      expect(inbound.status).toBe('PROCESSED');
    });

    it('a queued message without a valid key goes DEAD, with no redelivery and no NFe change', async () => {
      const id = await createNfe();
      await bus.publish(TOPIC_RESULT, { cnpj: '12345678000190' });
      await runJobs();

      const [dead] = await messages(TOPIC_RESULT);
      expect(dead).toMatchObject({ status: 'DEAD', attempts: 1 });
      expect((await getNfe(id)).body.status).toBe('ANALISE');
    });
  });

  describe('the same result delivered twice', () => {
    it('the same message delivered twice does not change the NFe again', async () => {
      const id = await createNfe();
      await providerReturns(completeResult).expect(202);
      await runJobs();
      const first = (await getNfe(id)).body;

      await providerReturns(completeResult).expect(202);
      await runJobs();

      expect(await messages(TOPIC_RESULT)).toHaveLength(2);
      expect((await getNfe(id)).body).toEqual(first);
    });

    it('simultaneous deliveries change the NFe only once', async () => {
      const id = await createNfe();
      await Promise.all([providerReturns(completeResult), providerReturns(completeResult)]);
      await Promise.all([worker.runCycle(), worker.runCycle()]);

      const deliveries = await messages(TOPIC_RESULT);
      expect(deliveries.map((m) => m.status)).toEqual(['PROCESSED', 'PROCESSED']);
      const nfe = (await getNfe(id)).body;
      expect(nfe.status).toBe('APROVADA');
      expect(nfe.updatedAt).toBe(nfe.approvedAt);
    });

    it('a divergent result after the decision is ignored', async () => {
      const id = await createNfe();
      await providerReturns(completeResult).expect(202);
      await runJobs();
      const approved = (await getNfe(id)).body;

      await providerReturns({ ...completeResult, cancelled: true }).expect(202);
      await runJobs();

      expect((await getNfe(id)).body).toEqual(approved);
    });

    it('a consumption failure rolls back the transaction and the queue redelivers the message', async () => {
      const id = await createNfe();
      await providerReturns(completeResult).expect(202);

      // Fails the transaction after the NFe has been updated, when the message is acknowledged.
      await withFailingTrigger('queue_messages', 'BEFORE UPDATE OF processed_at', async () => {
        await worker.runCycle();

        const [pending] = await messages(TOPIC_RESULT);
        expect(pending).toMatchObject({ status: 'PENDING', attempts: 1 });
        expect((await getNfe(id)).body.status).toBe('ANALISE');
      });

      await worker.runCycle();

      const [processed] = await messages(TOPIC_RESULT);
      expect(processed).toMatchObject({ status: 'PROCESSED', attempts: 2 });
      expect((await getNfe(id)).body.status).toBe('APROVADA');
    });
  });

  describe('publish failure: the NFe is not lost nor approved', () => {
    it('does not lose the NFe nor approve it: the request succeeded and the relay retries', async () => {
      const { id } = (await postNfe().expect(201)).body;
      jest.spyOn(bus, 'publish').mockRejectedValueOnce(new Error('queue down'));

      await relay.runCycle();

      expect((await getNfe(id)).body).toMatchObject({ status: 'ANALISE', approvedAt: null });
      expect(await messages(TOPIC_ENRICHMENT)).toHaveLength(0);
      expect((await outboxEntries())[0]).toMatchObject({ attempts: 1, last_error: 'queue down', published_at: null });

      await relay.runCycle();

      expect((await outboxEntries())[0]).toMatchObject({ attempts: 2 });
      expect((await outboxEntries())[0].published_at).not.toBeNull();
      expect(await messages(TOPIC_ENRICHMENT)).toHaveLength(1);
      expect((await getNfe(id)).body.status).toBe('ANALISE');
    });

    it('a failed entry does not block the next ones', async () => {
      const otherKey = '9'.repeat(44);
      await postNfe().expect(201);
      await postNfe({ accessKey: otherKey }).expect(201);
      jest.spyOn(bus, 'publish').mockRejectedValueOnce(new Error('queue down'));

      await relay.runCycle();

      const published = await messages(TOPIC_ENRICHMENT);
      expect(published).toHaveLength(1);
      expect(published[0].payload).toMatchObject({ accessKey: otherKey });
    });

    it('concurrent relays publish each entry once', async () => {
      await postNfe().expect(201);

      await Promise.all([relay.runCycle(), relay.runCycle(), relay.runCycle()]);

      expect(await messages(TOPIC_ENRICHMENT)).toHaveLength(1);
    });

    it('the NFe and its outbox entry are atomic: a failed entry leaves no NFe, and 503 is answered', async () => {
      await withFailingTrigger('outbox', 'BEFORE INSERT', async () => {
        await postNfe().expect(503);

        expect(await countNfes()).toBe(0);
        expect(await outboxEntries()).toHaveLength(0);
      });

      await postNfe().expect(201);
      expect(await countNfes()).toBe(1);
      expect(await outboxEntries()).toHaveLength(1);
    });

    it('a failure publishing the result returns 503, and the provider can retry', async () => {
      const id = await createNfe();
      jest.spyOn(bus, 'publish').mockRejectedValueOnce(new Error('queue down'));

      await providerReturns(completeResult).expect(503);
      await runJobs();
      expect((await getNfe(id)).body.status).toBe('ANALISE');

      await providerReturns(completeResult).expect(202);
      await runJobs();
      expect((await getNfe(id)).body.status).toBe('APROVADA');
    });
  });

  describe('concurrent workers', () => {
    it('deliver each outbound message to the provider once', async () => {
      await postNfe().expect(201);
      await relay.runCycle();

      await Promise.all([worker.runCycle(), worker.runCycle(), worker.runCycle()]);

      expect(provider.requests).toHaveLength(1);
      expect((await messages(TOPIC_ENRICHMENT))[0]).toMatchObject({ status: 'PROCESSED', attempts: 1 });
    });
  });

  describe('provider failure and redelivery', () => {
    it('keeps the NFe in ANALISE, and the call is redelivered', async () => {
      provider.remainingFailures = 1;

      const id = await createNfe();

      expect((await getNfe(id)).body.status).toBe('ANALISE');
      expect(provider.requests).toHaveLength(0);
      expect((await messages(TOPIC_ENRICHMENT))[0]).toMatchObject({ status: 'PENDING', attempts: 1 });

      await worker.runCycle();

      expect(provider.requests).toHaveLength(1);
      expect((await messages(TOPIC_ENRICHMENT))[0]).toMatchObject({ status: 'PROCESSED', attempts: 2 });
    });

    it('after exhausting attempts, the message goes DEAD and the NFe stays in ANALISE', async () => {
      provider.remainingFailures = 3;

      const id = await createNfe();
      await worker.runCycle();
      await worker.runCycle();
      await worker.runCycle();

      expect((await messages(TOPIC_ENRICHMENT))[0]).toMatchObject({ status: 'DEAD', attempts: 3 });
      expect((await getNfe(id)).body.status).toBe('ANALISE');
      expect(provider.requests).toHaveLength(0);
    });
  });

  describe('logs', () => {
    /** Replaces the logger and returns everything written from now on, in order. */
    const captureLogs = (): Array<Record<string, unknown>> => {
      const entries: Array<Record<string, unknown>> = [];
      for (const level of ['log', 'warn', 'error'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          entries.push({ level, ...(args[0] as object) });
        });
      }
      return entries;
    };

    const events = (entries: Array<Record<string, unknown>>) => entries.map((entry) => entry.event);

    it('follows an approved NFe through every step, correlated by the access key', async () => {
      const entries = captureLogs();

      const id = await createNfe();
      await providerReturns(completeResult).expect(202);
      await runJobs();

      expect(events(entries)).toEqual([
        'nfe.created',
        'http.request',
        'outbox.published',
        'provider.enrichment_requested',
        'queue.message_processed',
        'result.received',
        'http.request',
        'nfe.approved',
        'queue.message_processed',
      ]);
      expect(entries.find((entry) => entry.event === 'nfe.approved')).toMatchObject({ nfeId: id, accessKey: ACCESS_KEY });
      for (const entry of entries.filter((item) => item.event !== 'http.request')) {
        expect(entry.accessKey).toBe(ACCESS_KEY);
      }
    });

    it('logs the HTTP method, path, status and duration, including requests refused by the guard', async () => {
      const entries = captureLogs();

      await providerReturns(completeResult, 'wrong-token').expect(401);

      expect(entries).toEqual([
        expect.objectContaining({
          level: 'warn',
          event: 'http.request',
          method: 'POST',
          path: '/webhooks/provider',
          status: 401,
          durationMs: expect.any(Number),
        }),
      ]);
    });

    it('logs the rejection reason and the duplicate request', async () => {
      await createNfe();
      const entries = captureLogs();

      await postNfe().expect(200);
      await providerReturns({ ...completeResult, cnpj: undefined }).expect(202);
      await runJobs();

      expect(events(entries)).toContain('nfe.duplicate_request');
      expect(entries.find((entry) => entry.event === 'nfe.rejected')).toMatchObject({
        reason: 'Missing or invalid data: cnpj',
      });
    });

    it('tells an unknown key apart from an NFe already decided', async () => {
      const entries = captureLogs();

      await providerReturns(completeResult).expect(202);
      await runJobs();
      expect(events(entries)).toContain('result.ignored_unknown_key');

      await createNfe();
      await providerReturns(completeResult).expect(202);
      await runJobs();
      await providerReturns(completeResult).expect(202);
      await runJobs();

      expect(entries.find((entry) => entry.event === 'result.ignored_already_decided')).toMatchObject({
        currentStatus: 'APROVADA',
      });
    });

    it('does not report an approval that was rolled back', async () => {
      await createNfe();
      await providerReturns(completeResult).expect(202);
      const entries = captureLogs();

      await withFailingTrigger('queue_messages', 'BEFORE UPDATE OF processed_at', async () => {
        await worker.runCycle();
      });

      expect(events(entries)).not.toContain('nfe.approved');
      expect(entries.find((entry) => entry.event === 'queue.message_failed')).toMatchObject({
        level: 'warn',
        topic: TOPIC_RESULT,
        accessKey: ACCESS_KEY,
        attempt: 1,
        error: 'simulated failure',
      });
    });

    it('reports publish failures, retries and dead messages', async () => {
      const entries = captureLogs();
      provider.remainingFailures = 3;
      await postNfe().expect(201);
      jest.spyOn(bus, 'publish').mockRejectedValueOnce(new Error('queue down'));

      await relay.runCycle();
      expect(entries.find((entry) => entry.event === 'outbox.publish_failed')).toMatchObject({
        level: 'warn',
        attempt: 1,
        error: 'queue down',
      });

      await relay.runCycle();
      await worker.runCycle();
      await worker.runCycle();
      await worker.runCycle();

      expect(entries.filter((entry) => entry.event === 'queue.message_failed').map((entry) => entry.attempt)).toEqual([
        1, 2,
      ]);
      expect(entries.find((entry) => entry.event === 'queue.message_dead')).toMatchObject({ level: 'error', attempt: 3 });
    });

    it('never writes the token or the result data', async () => {
      const entries = captureLogs();
      // Differs from the CNPJ embedded in the access key, which is logged on purpose.
      const result = { ...completeResult, cnpj: '98765432000111', amount: '777.77' };

      await createNfe();
      await providerReturns(result).expect(202);
      await runJobs();
      await providerReturns({ ...result, cancelled: true }).expect(202);
      await runJobs();

      const written = JSON.stringify(entries);
      expect(written).not.toContain(TOKEN);
      expect(written).not.toContain(result.cnpj);
      expect(written).not.toContain(result.amount);
    });
  });

  describe('webhook authentication and validation', () => {
    it.each([
      ['wrong', 'wrong-token'],
      ['empty', ''],
    ])('refuses a token that is %s, without publishing', async (_description, token) => {
      await providerReturns(completeResult, token).expect(401);
      expect(await messages(TOPIC_RESULT)).toHaveLength(0);
    });

    it('refuses a request without the token header', async () => {
      await request(app.getHttpServer()).post('/webhooks/provider').send(completeResult).expect(401);
      expect(await messages(TOPIC_RESULT)).toHaveLength(0);
    });

    it('refuses a result without a valid key', async () => {
      await providerReturns({ ...completeResult, accessKey: '123' }).expect(400);
      expect(await messages(TOPIC_RESULT)).toHaveLength(0);
    });

    it('refuses an array body or no body at all', async () => {
      await providerReturns([completeResult]).expect(400);
      await request(app.getHttpServer()).post('/webhooks/provider').set('x-webhook-token', TOKEN).expect(400);

      expect(await messages(TOPIC_RESULT)).toHaveLength(0);
    });

    it('checks the token before validating the body', async () => {
      await providerReturns({ accessKey: '123' }, 'wrong-token').expect(401);
    });

    it.each([
      ['cnpj', 12345678000190],
      ['amount', 10.5],
      ['amount', { value: 1 }],
      ['issueDate', 'yesterday'],
      ['cancelled', 'false'],
    ])('accepts %s = %j, and the NFe becomes REJEITADA with a reason', async (field, content) => {
      const id = await createNfe();

      await providerReturns({ ...completeResult, [field]: content }).expect(202);
      await runJobs();

      expect((await getNfe(id)).body).toMatchObject({
        status: 'REJEITADA',
        rejectionReason: `Missing or invalid data: ${field}`,
      });
    });

    it('publishes only the contract fields', async () => {
      await providerReturns({ ...completeResult, extra: 'discard' }).expect(202);

      expect((await messages(TOPIC_RESULT))[0].payload).toEqual(completeResult);
    });
  });
});
