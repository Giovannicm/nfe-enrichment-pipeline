import { EnrichmentResult } from './contracts';

export interface ResultEvaluation {
  status: 'APROVADA' | 'REJEITADA';
  reason: string | null;
  cnpj: string | null;
  amount: string | null;
  issueDate: string | null;
  cancelled: boolean | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** Pure decision rule. Only `cancelled === false` with all data valid approves. */
export function evaluateResult(result: EnrichmentResult): ResultEvaluation {
  const cnpj = readCnpj(result.cnpj);
  const amount = readAmount(result.amount);
  const issueDate = readDate(result.issueDate);
  const cancelled = typeof result.cancelled === 'boolean' ? result.cancelled : null;
  const data = { cnpj, amount, issueDate, cancelled };

  if (cancelled === true) {
    return { status: 'REJEITADA', reason: 'NFe cancelled', ...data };
  }

  const missing = Object.entries(data)
    .filter(([, content]) => content === null)
    .map(([field]) => field);

  if (missing.length > 0) {
    return { status: 'REJEITADA', reason: `Missing or invalid data: ${missing.join(', ')}`, ...data };
  }
  return { status: 'APROVADA', reason: null, ...data };
}

function readCnpj(cnpj: unknown): string | null {
  return typeof cnpj === 'string' && /^\d{14}$/.test(cnpj) ? cnpj : null;
}

function readAmount(amount: unknown): string | null {
  return typeof amount === 'string' && /^\d{1,13}(\.\d{1,2})?$/.test(amount) ? amount : null;
}

function readDate(date: unknown): string | null {
  if (typeof date !== 'string') {
    return null;
  }
  const parts = ISO_DATE.exec(date);
  const instant = new Date(date);
  if (!parts || Number.isNaN(instant.getTime())) {
    return null;
  }
  // The JS parser may accept Feb 31 and roll over to March; the date must exist in the calendar.
  const [year, month, day] = parts.slice(1, 4).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const exists =
    calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
  return exists ? instant.toISOString() : null;
}
