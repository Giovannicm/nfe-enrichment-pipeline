import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { isString } from 'class-validator';

/** Keeps Nest's default layout, printing each event on one line: `nfe.created nfeId=... accessKey=...`. */
export class EventConsoleLogger extends ConsoleLogger {
  protected override stringifyMessage(message: unknown, logLevel: LogLevel): string {
    return super.stringifyMessage(isEvent(message) ? formatEvent(message) : message, logLevel);
  }
}

export function formatEvent({ event, ...fields }: { event: string; [field: string]: unknown }): string {
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => `${field}=${formatValue(value)}`);
  return [event, ...pairs].join(' ');
}

function formatValue(value: unknown): string {
  return isString(value) && !value.includes(' ') ? value : JSON.stringify(value);
}

function isEvent(message: unknown): message is { event: string } {
  return isString((message as { event?: unknown } | null)?.event);
}
