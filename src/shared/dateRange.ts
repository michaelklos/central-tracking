/**
 * Date range helpers for converting YYYY-MM-DD inputs into ISO timestamps
 * suitable for inclusive date-range queries against the time-entry APIs.
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

function assertDateString(input: string): void {
  if (!DATE_REGEX.test(input)) {
    throw new Error(`Invalid date "${input}" — expected YYYY-MM-DD`);
  }
}

export function toIsoStartOfDay(dateStr: string): string {
  assertDateString(dateStr);
  return `${dateStr}T00:00:00.000Z`;
}

export function toIsoEndOfDay(dateStr: string): string {
  assertDateString(dateStr);
  return `${dateStr}T23:59:59.999Z`;
}
