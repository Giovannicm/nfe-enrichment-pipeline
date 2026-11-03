import { numericEnv, requiredEnv } from './config';

describe('environment variables', () => {
  const NAME = 'CONFIG_SPEC_VALUE';

  afterEach(() => {
    delete process.env[NAME];
  });

  it('returns a required variable', () => {
    process.env[NAME] = 'value';
    expect(requiredEnv(NAME)).toBe('value');
  });

  it.each([undefined, ''])('refuses a required variable that is %j', (value) => {
    if (value !== undefined) {
      process.env[NAME] = value;
    }
    expect(() => requiredEnv(NAME)).toThrow(`Missing required environment variable: ${NAME}`);
  });

  it.each([undefined, ''])('uses the fallback when a numeric variable is %j', (value) => {
    if (value !== undefined) {
      process.env[NAME] = value;
    }
    expect(numericEnv(NAME, 7)).toBe(7);
  });

  it('reads a numeric variable', () => {
    process.env[NAME] = '25';
    expect(numericEnv(NAME, 7, 1)).toBe(25);
  });

  it.each(['abc', '1.5', '0'])('refuses the numeric value %j when the minimum is 1', (value) => {
    process.env[NAME] = value;
    expect(() => numericEnv(NAME, 7, 1)).toThrow(`Invalid environment variable ${NAME}`);
  });
});
