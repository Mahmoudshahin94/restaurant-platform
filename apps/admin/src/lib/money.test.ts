import { describe, expect, it } from 'vitest';
import { moneyField, optionalMoneyField } from './money';

describe('money form fields', () => {
  it('parses decimal input into minor units using the currency precision', () => {
    expect(moneyField('SAR').parse('18.5')).toBe(1850);
    expect(moneyField('KWD').parse('1.250')).toBe(1250);
  });

  it('rejects extra decimals, negatives and garbage with translation keys', () => {
    for (const bad of ['1.005', '-1', 'abc']) {
      const result = moneyField('SAR').safeParse(bad);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('common:validation.invalidAmount');
    }
    expect(moneyField('SAR').safeParse('').error?.issues[0]?.message).toBe(
      'common:validation.required',
    );
  });

  it('treats empty optional input as null', () => {
    expect(optionalMoneyField('SAR').parse('')).toBeNull();
    expect(optionalMoneyField('SAR').parse('2')).toBe(200);
  });
});
