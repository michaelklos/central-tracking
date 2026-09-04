/**
 * SQLite's `datetime('now')` yields `YYYY-MM-DD HH:MM:SS` — UTC, but with a
 * space separator and no zone suffix. V8 parses that shape as **local** time,
 * so west of UTC a freshly written timestamp reads as several hours in the
 * future: `getDaysAgo` in the recycle bin rendered "deleted -1 days ago".
 *
 * Values are normalized on the way out rather than on the way in. The schema
 * defaults and roughly two dozen `updated_at = datetime('now')` writes all
 * produce this format, and raw string comparisons depend on it — `main.ts`
 * purges with `deleted_at < datetime('now', '-30 days')`, which is a string
 * compare. Writing ISO going forward would leave the table holding both
 * shapes, and `T` sorts after a space, so those comparisons would quietly
 * start giving wrong answers on same-date rows. Normalizing on read also fixes
 * the rows already in the database, which writing ISO would not.
 */

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Convert a SQLite `datetime()` string to ISO 8601. Values that are already
 * ISO (anything the handlers wrote with `toISOString()`) pass through
 * untouched, as do null and unrecognized shapes.
 */
export function sqliteTimeToIso(value: string): string;
export function sqliteTimeToIso(value: string | null): string | null;
export function sqliteTimeToIso(value: string | null): string | null {
  if (value === null) return null;
  if (!SQLITE_DATETIME.test(value)) return value;
  return `${value.replace(' ', 'T')}.000Z`;
}
