import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { createTask } from '../taskHandlers';
import { getSummaryReport, getTimeEntryReport, getTodayTotal } from '../timeEntryHandlers';
import { generateCsvContent } from '../../reports/csvGenerator';
import { toIsoStartOfDay, toIsoEndOfDay, isoToLocalDateString, toLocalDateString } from '../../../shared/dateRange';

/**
 * Review finding 5: "which day does this timestamp belong to" was answered
 * three different ways — `getTodayTotal` and task sorting used SQLite
 * `localtime`, the report queries grouped by the UTC date, and the range
 * endpoints were literal `Z` strings built from local calendar dates.
 *
 * For a user west of UTC, an evening entry counted toward "Today" in the
 * sidebar and then dropped out of the report, the pie charts and the CSV
 * export for that same day.
 *
 * The suite pins TZ=America/New_York (see vitest.config.ts) so a local day is
 * genuinely not a UTC day; under TZ=UTC these tests would pass without
 * exercising anything.
 */
describe('local day boundaries', () => {
  let db: Database;
  let taskId: string;

  // 8pm local on 2026-03-10 — 2026-03-11 in UTC, which is the whole point.
  const eveningStart = new Date(2026, 2, 10, 20, 0, 0, 0);
  const eveningEnd = new Date(2026, 2, 10, 21, 0, 0, 0);

  beforeEach(() => {
    db = new Database(':memory:');
    taskId = createTask(db, { title: 'Evening work' }).id;
    db.instance
      .prepare(
        `INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at)
         VALUES ('e1', ?, ?, ?, 3600, '', ?)`,
      )
      .run(taskId, eveningStart.toISOString(), eveningEnd.toISOString(), eveningStart.toISOString());
  });

  afterEach(() => db.close());

  it('confirms the fixture straddles the UTC date line', () => {
    expect(eveningStart.toISOString().slice(0, 10)).toBe('2026-03-11');
    expect(isoToLocalDateString(eveningStart.toISOString())).toBe('2026-03-10');
  });

  it('includes an evening entry in the summary report for its local day', () => {
    const rows = getSummaryReport(db, toIsoStartOfDay('2026-03-10'), toIsoEndOfDay('2026-03-10'));
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-03-10');
    expect(rows[0].totalSeconds).toBe(3600);
  });

  it('excludes it from the next local day, which UTC grouping would claim it for', () => {
    const rows = getSummaryReport(db, toIsoStartOfDay('2026-03-11'), toIsoEndOfDay('2026-03-11'));
    expect(rows).toEqual([]);
  });

  it('labels it with the local day in the detail report', () => {
    const rows = getTimeEntryReport(db, toIsoStartOfDay('2026-03-10'), toIsoEndOfDay('2026-03-10'));
    expect(rows.map((r) => r.date)).toEqual(['2026-03-10']);
  });

  it('exports a CSV row whose Date, Start and End all name the same local day', () => {
    const csv = generateCsvContent(db, toIsoStartOfDay('2026-03-10'), toIsoEndOfDay('2026-03-10'));
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toBeDefined();

    // Asserting only the Date column would miss the file disagreeing with
    // itself: Date local, Start/End raw UTC ISO naming the next day.
    const [date, , startCol, endCol] = dataLine.split(',');
    expect(date).toBe('2026-03-10');
    expect(startCol).toBe('2026-03-10 20:00:00');
    expect(endCol).toBe('2026-03-10 21:00:00');
  });

  it('agrees with getTodayTotal, which has always used localtime', () => {
    // Seed 8pm-9pm local TODAY. That is tomorrow in UTC, so this comparison
    // holds regardless of what time the suite runs at — anchoring it to the
    // actual current hour would only catch the bug when run in the evening.
    const fresh = new Database(':memory:');
    const t = createTask(fresh, { title: 'Tonight' }).id;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0, 0);
    expect(start.toISOString().slice(0, 10)).not.toBe(toLocalDateString(start));

    fresh.instance
      .prepare(
        `INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at)
         VALUES ('e2', ?, ?, ?, 3600, '', ?)`,
      )
      .run(t, start.toISOString(), end.toISOString(), start.toISOString());

    const today = toLocalDateString(start);
    const total = getTodayTotal(fresh);
    const rows = getSummaryReport(fresh, toIsoStartOfDay(today), toIsoEndOfDay(today));
    const reported = rows.reduce((sum, r) => sum + r.totalSeconds, 0);

    expect(total).toBe(3600);
    expect(reported).toBe(total);
    fresh.close();
  });

  it('spans a 25-hour day across the DST fall-back without dropping an hour', () => {
    // 2026-11-01 is the US fall-back date; the local day is 25 hours long.
    const start = toIsoStartOfDay('2026-11-01');
    const end = toIsoEndOfDay('2026-11-01');
    const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(24.9);
    expect(hours).toBeLessThan(25.1);
  });
});
