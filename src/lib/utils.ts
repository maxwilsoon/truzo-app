/** Show £5 not £5.00, but £5.50 stays £5.50 */
export const fmtAmt = (n: number): string => n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2);

// ─── Repayment date helpers ────────────────────────────────────────────────────

const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/**
 * Parses a repayment date string from any of the formats the app or DB may
 * produce and returns a local-midnight Date, or null if unparseable.
 *
 * Handles:
 *   "22 Jul"       — TO_CHAR(date,'DD Mon') from get_active_requests RPC
 *   "07 Jul"       — zero-padded day variant
 *   "2026-07-22"   — raw ISO date from PostgreSQL DATE column
 *   "2026-07-22T…" — ISO with time
 *   "Thu, 22 July 2026" — toLocaleDateString output stored locally
 */
export function parseRepaymentDate(raw: string | null | undefined): Date | null {
  if (!raw) {
    if (__DEV__) console.warn('[Truzo] repayByDate missing:', raw);
    return null;
  }

  // 1. ISO date: "2026-07-22" or "2026-07-22T..."
  const isoM = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) {
    const d = new Date(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // 2. "DD Mon" — TO_CHAR format from Supabase RPC: "22 Jul", "07 Jan"
  const ddMonM = raw.match(/^(\d{1,2})\s([A-Za-z]{3})$/);
  if (ddMonM) {
    const day = Number(ddMonM[1]);
    const monIdx = MON_SHORT.findIndex(m => m.toLowerCase() === ddMonM[2].toLowerCase());
    if (monIdx >= 0 && day >= 1 && day <= 31) {
      const year = new Date().getFullYear();
      const d = new Date(year, monIdx, day);
      // If the resulting date is more than 60 days in the past, it wraps to next year
      if (d.getTime() < Date.now() - 60 * 86_400_000) {
        return new Date(year + 1, monIdx, day);
      }
      return d;
    }
  }

  // 3. Native parse as last resort (handles locale strings, RFC 2822, etc.)
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    // Convert to local midnight to avoid UTC-offset shifting the day
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  if (__DEV__) console.warn('[Truzo] Could not parse repayByDate:', raw);
  return null;
}

/** Returns the human-readable due label for a repayment date string. */
export function repayDueLabel(raw: string | null | undefined): string {
  const due = parseRepaymentDate(raw);
  if (!due) return 'Repayment date unavailable';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff > 1 && diff <= 7) return `Due in ${diff} days`;
  if (diff > 7) {
    const sameYear = due.getFullYear() === new Date().getFullYear();
    return sameYear
      ? `Due ${due.getDate()} ${MONTH_FULL[due.getMonth()]}`
      : `Due ${due.getDate()} ${MONTH_FULL[due.getMonth()]} ${due.getFullYear()}`;
  }
  // diff < 0 — overdue
  const days = -diff;
  return days === 1 ? 'Overdue by 1 day' : `Overdue by ${days} days`;
}

/** Returns { day, month } for the calendar widget, or null if date is invalid. */
export function repayCalendarDate(raw: string | null | undefined): { day: string; month: string } | null {
  const d = parseRepaymentDate(raw);
  if (!d) return null;
  return {
    day: String(d.getDate()),
    month: MON_SHORT[d.getMonth()].toUpperCase(),
  };
}
