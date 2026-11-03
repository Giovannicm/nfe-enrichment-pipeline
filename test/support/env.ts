// Outside compose, uses the db-test database published on localhost:5433.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5433/nfes_test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.QUEUE_REDELIVERY_DELAY_MS = '0';
process.env.QUEUE_MAX_ATTEMPTS = '3';
