/**
 * Currency normalisation. All scoring happens in EUR. Provider currencies are
 * converted with the configured static rates (a live FX service can replace
 * `rates` without touching callers).
 */
export function convertToEur(amount: number, currency: string, rates: Record<string, number>): number {
  const cur = currency.toUpperCase();
  if (cur === 'EUR') return round2(amount);
  const rate = rates[cur];
  if (rate === undefined) {
    throw new Error(`No EUR conversion rate configured for currency ${cur}`);
  }
  return round2(amount * rate);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatEur(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const rounded = Math.round(n);
  const abs = Math.abs(rounded).toLocaleString('en-US');
  const sign = rounded < 0 ? '-' : opts.sign && rounded > 0 ? '+' : '';
  return `${sign}€${abs}`;
}
