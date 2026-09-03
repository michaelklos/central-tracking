import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from './harness';
import { registerReportCommands } from '../../commands/report';

describe('ct report summary', () => {
  it('converts --from/--to to local start-of-day / end-of-day ISO', async () => {
    const { calls } = await runCli(
      registerReportCommands,
      ['report', 'summary', '--from', '2026-04-01', '--to', '2026-04-07'],
      { responses: { 'timeEntries/getSummaryReport': [] } },
    );
    expect(calls[0].endpoint).toBe('timeEntries/getSummaryReport');
    const [start, end] = calls[0].args as [string, string];
    // A day is a local calendar day, so the endpoints are the instants of
    // local midnight and 23:59:59.999 — not the literal `Z` strings this used
    // to assert, which dropped an evening's entries west of UTC.
    expect(start).toBe(new Date(2026, 3, 1, 0, 0, 0, 0).toISOString());
    expect(end).toBe(new Date(2026, 3, 7, 23, 59, 59, 999).toISOString());
  });

  it('renders empty-range message', async () => {
    const { stdout } = await runCli(
      registerReportCommands,
      ['report', 'summary', '--from', '2026-04-01', '--to', '2026-04-07'],
      { responses: { 'timeEntries/getSummaryReport': [] } },
    );
    expect(stdout).toContain('No time entries');
  });
});

describe('ct report detail', () => {
  it('queries getByDateRangeWithTasks', async () => {
    const { calls } = await runCli(
      registerReportCommands,
      ['report', 'detail', '--from', '2026-04-01', '--to', '2026-04-07'],
      { responses: { 'timeEntries/getByDateRangeWithTasks': [] } },
    );
    expect(calls[0].endpoint).toBe('timeEntries/getByDateRangeWithTasks');
  });
});

describe('ct report chart', () => {
  it('emits JSON unconditionally', async () => {
    const payload = [{ date: '2026-04-01', taskId: 't', seconds: 60 }];
    const { stdout } = await runCli(
      registerReportCommands,
      ['report', 'chart', '--from', '2026-04-01', '--to', '2026-04-01'],
      { responses: { 'timeEntries/getReport': payload } },
    );
    expect(JSON.parse(stdout)).toEqual(payload);
  });
});

describe('ct report export', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-report-'));
  const outFile = path.join(tmp, 'out.csv');

  afterEach(() => {
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  });

  it('writes to --out file and notes it on stderr', async () => {
    const { stderr } = await runCli(
      registerReportCommands,
      ['report', 'export', '--from', '2026-04-01', '--to', '2026-04-01', '--out', outFile],
      { responses: { 'reports/generateCsv': 'a,b,c\n1,2,3\n' } },
    );
    expect(fs.readFileSync(outFile, 'utf-8')).toBe('a,b,c\n1,2,3\n');
    expect(stderr).toContain(`Exported to ${outFile}`);
  });

  it('prints CSV to stdout when --out omitted', async () => {
    const { stdout } = await runCli(
      registerReportCommands,
      ['report', 'export', '--from', '2026-04-01', '--to', '2026-04-01'],
      { responses: { 'reports/generateCsv': 'a,b\n1,2\n' } },
    );
    expect(stdout).toContain('a,b');
  });
});
