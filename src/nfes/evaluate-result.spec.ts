import { evaluateResult } from './evaluate-result';

const complete = {
  accessKey: '1'.repeat(44),
  cnpj: '12345678000190',
  amount: '1234.56',
  issueDate: '2026-10-30T12:00:00Z',
  cancelled: false,
};

describe('evaluateResult', () => {
  it('approves a complete, non-cancelled result', () => {
    expect(evaluateResult(complete)).toEqual({
      status: 'APROVADA',
      reason: null,
      cnpj: '12345678000190',
      amount: '1234.56',
      issueDate: '2026-10-30T12:00:00.000Z',
      cancelled: false,
    });
  });

  it.each(['0', '0.00'])('treats the amount %s as present', (amount) => {
    expect(evaluateResult({ ...complete, amount }).status).toBe('APROVADA');
  });

  it('accepts a date without time', () => {
    expect(evaluateResult({ ...complete, issueDate: '2026-10-30' }).status).toBe('APROVADA');
  });

  it('rejects a cancelled NFe, even with complete data', () => {
    const evaluation = evaluateResult({ ...complete, cancelled: true });
    expect(evaluation.status).toBe('REJEITADA');
    expect(evaluation.reason).toBe('NFe cancelled');
  });

  it('prioritizes cancellation in the reason when data is also missing', () => {
    expect(evaluateResult({ accessKey: complete.accessKey, cancelled: true }).reason).toBe('NFe cancelled');
  });

  it.each(['cnpj', 'amount', 'issueDate', 'cancelled'])('rejects when %s is missing', (field) => {
    const evaluation = evaluateResult({ ...complete, [field]: undefined });
    expect(evaluation.status).toBe('REJEITADA');
    expect(evaluation.reason).toBe(`Missing or invalid data: ${field}`);
  });

  it.each([
    ['cnpj', null],
    ['cnpj', ''],
    ['cnpj', '123'],
    ['cnpj', 12345678000190],
    ['amount', null],
    ['amount', ''],
    ['amount', 'abc'],
    ['amount', '-1.00'],
    ['amount', 10.5],
    ['amount', '1.234'],
    ['issueDate', null],
    ['issueDate', ''],
    ['issueDate', 'yesterday'],
    ['issueDate', '2026-02-31'],
    ['issueDate', '2026-13-01T00:00:00Z'],
    ['cancelled', 'false'],
    ['cancelled', null],
  ])('rejects when %s is %j', (field, content) => {
    const evaluation = evaluateResult({ ...complete, [field]: content });
    expect(evaluation.status).toBe('REJEITADA');
    expect(evaluation.reason).toContain(field);
  });

  it('lists every missing field', () => {
    expect(evaluateResult({ accessKey: complete.accessKey, cancelled: false }).reason).toBe(
      'Missing or invalid data: cnpj, amount, issueDate',
    );
  });
});
