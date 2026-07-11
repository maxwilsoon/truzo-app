/** Format a monetary amount without trailing .00 — e.g. 5 → "5", 5.5 → "5.50", 5.25 → "5.25" */
export function fmtAmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
