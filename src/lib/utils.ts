/** Show £5 not £5.00, but £5.50 stays £5.50 */
export const fmtAmt = (n: number): string => n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2);
