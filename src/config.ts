export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function numericEnv(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : Number(value);
}
