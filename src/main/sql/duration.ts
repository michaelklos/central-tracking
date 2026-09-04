/**
 * One definition of "how long is a time entry", used by every query that sums
 * time. It appeared in seven places in two variants that had to be kept in
 * step by hand.
 *
 * The two variants are a real distinction, not drift:
 * - `completed` counts a still-running entry as zero. Totals shown against a
 *   task come out this way and the live counter is added in the renderer, so
 *   the number does not jump around between refreshes.
 * - `withRunning` counts a running entry up to now. Reports use it so the
 *   time being tracked right now appears in today's row.
 */
export type DurationVariant = 'completed' | 'withRunning';

/**
 * A SQL expression giving one entry's duration in whole seconds.
 * `prefix` qualifies the columns for joined queries (e.g. `'te.'`).
 */
export function durationSeconds(variant: DurationVariant, prefix = ''): string {
  const elapsed = (from: string) =>
    `CAST(ROUND((julianday(${from}) - julianday(${prefix}start_time)) * 86400) AS INTEGER)`;
  const running = variant === 'withRunning' ? elapsed(`'now'`) : '0';
  return `CASE WHEN ${prefix}end_time IS NOT NULL
          THEN ${elapsed(`${prefix}end_time`)}
          ELSE ${running}
        END`;
}

/** `COALESCE(SUM(<duration>), 0)` — the form every caller actually uses. */
export function sumDurationSeconds(variant: DurationVariant, prefix = ''): string {
  return `COALESCE(SUM(${durationSeconds(variant, prefix)}), 0)`;
}
