import { describe, expect, it } from 'vitest';

import { formatCompact, formatPct, normalizeSearchText } from './formatting';

describe('normalizeSearchText', () => {
  it('removes accents, trims, and lowercases text', () => {
    expect(normalizeSearchText('  LíNea 12  ')).toBe('linea 12');
  });
});

describe('formatCompact', () => {
  it('formats thousands as compact k values', () => {
    expect(formatCompact(1250)).toBe('1k');
  });

  it('formats millions with one decimal place', () => {
    expect(formatCompact(1250000)).toBe('1.3M');
  });
});

describe('formatPct', () => {
  it('formats percentages with one decimal place', () => {
    expect(formatPct(12.34)).toBe('12.3%');
  });
});
