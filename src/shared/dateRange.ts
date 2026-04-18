/**
 * Date range helpers for converting YYYY-MM-DD inputs into ISO timestamps
 * suitable for inclusive date-range queries against the time-entry APIs.
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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
