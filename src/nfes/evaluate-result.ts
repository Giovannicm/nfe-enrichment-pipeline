import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsISO8601, Matches, validateSync } from 'class-validator';
import { EnrichmentResult } from './contracts';

export interface ResultEvaluation {
  status: 'APROVADA' | 'REJEITADA';
  reason: string | null;
  cnpj: string | null;
  amount: string | null;
  issueDate: string | null;
  cancelled: boolean | null;
}

/** What a result needs to approve the NFe. A field that breaks its rule counts as missing. */
class ResultData {
  @Matches(/^\d{14}$/)
  cnpj!: string;

  @Matches(/^\d{1,13}(\.\d{1,2})?$/)
  amount!: string;

  // Strict ISO 8601 refuses dates missing from the calendar, such as Feb 31. The pattern refuses
  // ISO forms without a full date, such as "2026" or week dates, and times without minutes.
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}|$)/)
  issueDate!: string;

  @IsBoolean()
  cancelled!: boolean;
}

const FIELDS = ['cnpj', 'amount', 'issueDate', 'cancelled'] as const;

/** Pure decision rule. Only `cancelled === false` with all data valid approves. */
export function evaluateResult(result: EnrichmentResult): ResultEvaluation {
  const data = plainToInstance(ResultData, {
    cnpj: result.cnpj,
    amount: result.amount,
    issueDate: result.issueDate,
    cancelled: result.cancelled,
  });
  const invalid = new Set(validateSync(data).map((error) => error.property));
  const valid = <Field extends (typeof FIELDS)[number]>(field: Field): ResultData[Field] | null =>
    invalid.has(field) ? null : data[field];

  const issueDate = valid('issueDate');
  const fields = {
    cnpj: valid('cnpj'),
    amount: valid('amount'),
    issueDate: issueDate === null ? null : new Date(issueDate).toISOString(),
    cancelled: valid('cancelled'),
  };

  if (fields.cancelled === true) {
    return { status: 'REJEITADA', reason: 'NFe cancelled', ...fields };
  }

  const missing = FIELDS.filter((field) => fields[field] === null);
  if (missing.length > 0) {
    return { status: 'REJEITADA', reason: `Missing or invalid data: ${missing.join(', ')}`, ...fields };
  }
  return { status: 'APROVADA', reason: null, ...fields };
}
