/**
 * Date range helpers for converting YYYY-MM-DD inputs into ISO timestamps
 * suitable for inclusive date-range queries against the time-entry APIs.
 *
 * A "day" here is a **local calendar day**. Every date the user types or picks
 * comes from a calendar in their own timezone, and the sidebar's "today" total
 * has always been computed with SQLite's `localtime`, so the local day is the
 * meaning the app already had in the place users check most.
 *
 * These helpers used to append a literal `Z`, making the range a UTC day. West
 * of UTC that silently dropped an evening's entries from every report while
 * still counting them in the sidebar. Anything that groups timestamps into days
 * must agree with this — see `date(start_time, 'localtime')` in the report
 * queries and `isoToLocalDateString` below.
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format a Date as YYYY-MM-DD in the user's local time. Date pickers compare
 * against the user's local calendar, so using toISOString() (UTC) would show
 * "yesterday" west of UTC during the evening.
 */
export function toLocalDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The local calendar date an ISO timestamp falls on. Use this instead of
 * `iso.split('T')[0]`, which reads the UTC date and so mislabels any entry
 * whose local and UTC dates differ.
 */
export function isoToLocalDateString(iso: string): string {
  return toLocalDateString(new Date(iso));
}

function assertDateString(input: string): void {
  if (!DATE_REGEX.test(input)) {
    throw new Error(`Invalid date "${input}" — expected YYYY-MM-DD`);
  }
}

/**
 * The instant local midnight begins on `dateStr`, as an ISO (UTC) timestamp.
 * Built from local wall-clock components, so a DST transition inside the day
 * is handled by the platform rather than by assuming a fixed offset.
 */
export function toIsoStartOfDay(dateStr: string): string {
  assertDateString(dateStr);
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

/** The last instant of the local day `dateStr`, as an ISO (UTC) timestamp. */
export function toIsoEndOfDay(dateStr: string): string {
  assertDateString(dateStr);
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}
