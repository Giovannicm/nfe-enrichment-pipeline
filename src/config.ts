import { isEmpty, isInt, isNotEmpty, min } from 'class-validator';

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!isNotEmpty(value)) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value as string;
}

/** Fails at startup on a malformed value, instead of letting NaN reach the queue settings. */
export function numericEnv(name: string, fallback: number, minimum = 0): number {
  const raw = process.env[name];
  if (isEmpty(raw)) {
    return fallback;
  }
  const value = Number(raw);
  if (!isInt(value) || !min(value, minimum)) {
    throw new Error(`Invalid environment variable ${name}: expected an integer of at least ${minimum}`);
  }
  return value;
}
