import { describe, it, expect } from 'vitest';
import { runCli } from './harness';
import { registerTimeCommands } from '../../commands/time';

const sampleEntry = {
  id: 'entry-1',
  taskId: 'task-1',
  startTime: '2026-04-17T10:00:00.000Z',
  endTime: '2026-04-17T10:30:00.000Z',
  durationSeconds: 1800,
  note: '',
  createdAt: '2026-04-17T10:00:00.000Z',
};

describe('ct time list', () => {
  it('paginates with defaults', async () => {
    const { calls } = await runCli(registerTimeCommands, ['time', 'list', 'task-1'], {
      responses: {
        'timeEntries/getByTaskPaginated': { items: [sampleEntry], total: 1, hasMore: false, offset: 0, limit: 20 },
      },
    });
    expect(calls).toEqual([
      { endpoint: 'timeEntries/getByTaskPaginated', args: ['task-1', { offset: 0, limit: 20 }] },
    ]);
  });
});

describe('ct time add', () => {
  it('--start/--end pass through verbatim', async () => {
    const { calls } = await runCli(
      registerTimeCommands,
      [
        'time',
        'add',
        'task-1',
        '--start',
        '2026-04-17T10:00:00.000Z',
        '--end',
        '2026-04-17T11:00:00.000Z',
      ],
      { responses: { 'timeEntries/create': sampleEntry } },
    );
    expect(calls[0].args[0]).toMatchObject({
      taskId: 'task-1',
      startTime: '2026-04-17T10:00:00.000Z',
      endTime: '2026-04-17T11:00:00.000Z',
      note: '',
    });
  });

  it('--duration 1h30m derives start/end from now', async () => {
    const { calls } = await runCli(
      registerTimeCommands,
      ['time', 'add', 'task-1', '--duration', '1h30m'],
      { responses: { 'timeEntries/create': sampleEntry } },
    );
    const arg = calls[0].args[0] as { startTime: string; endTime: string };
    const delta = new Date(arg.endTime).getTime() - new Date(arg.startTime).getTime();
    expect(delta).toBe(90 * 60 * 1000);
  });

  it('--duration 90 (bare minutes) is accepted', async () => {
    const { calls, exitCode } = await runCli(
      registerTimeCommands,
      ['time', 'add', 'task-1', '--duration', '90'],
      { responses: { 'timeEntries/create': sampleEntry } },
    );
    expect(exitCode).toBeNull();
    const arg = calls[0].args[0] as { startTime: string; endTime: string };
    const delta = new Date(arg.endTime).getTime() - new Date(arg.startTime).getTime();
    expect(delta).toBe(90 * 60 * 1000);
  });

  it('--duration 1:30 (colon notation) is accepted', async () => {
    const { calls } = await runCli(
      registerTimeCommands,
      ['time', 'add', 'task-1', '--duration', '1:30'],
      { responses: { 'timeEntries/create': sampleEntry } },
    );
    const arg = calls[0].args[0] as { startTime: string; endTime: string };
    const delta = new Date(arg.endTime).getTime() - new Date(arg.startTime).getTime();
    expect(delta).toBe(90 * 60 * 1000);
  });

  it('invalid duration exits 1 with helpful message', async () => {
    const result = await runCli(
      registerTimeCommands,
      ['time', 'add', 'task-1', '--duration', 'garbage'],
      { responses: {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid duration');
  });

  it('missing start/end and duration exits 1', async () => {
    const result = await runCli(registerTimeCommands, ['time', 'add', 'task-1'], { responses: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Specify --start and --end, or --duration');
  });
});

describe('ct time update/delete/today', () => {
  it('update omits untouched fields', async () => {
    const { calls } = await runCli(
      registerTimeCommands,
      ['time', 'update', 'entry-1', '--note', 'edit'],
      { responses: { 'timeEntries/update': sampleEntry } },
    );
    expect(calls).toEqual([{ endpoint: 'timeEntries/update', args: ['entry-1', { note: 'edit' }] }]);
  });

  it('delete calls timeEntries/delete', async () => {
    const { calls, stdout } = await runCli(
      registerTimeCommands,
      ['time', 'delete', 'entry-1'],
      { responses: { 'timeEntries/delete': undefined } },
    );
    expect(calls).toEqual([{ endpoint: 'timeEntries/delete', args: ['entry-1'] }]);
    expect(stdout).toContain('Deleted time entry entry-1');
  });

  it('today prints total', async () => {
    const { stdout, calls } = await runCli(registerTimeCommands, ['time', 'today'], {
      responses: { 'timeEntries/getTodayTotal': 3600 },
    });
    expect(calls).toEqual([{ endpoint: 'timeEntries/getTodayTotal', args: [] }]);
    expect(stdout).toContain('Today: 1h');
  });

  it('today --json emits structured payload', async () => {
    const { stdout } = await runCli(registerTimeCommands, ['time', 'today', '--json'], {
      responses: { 'timeEntries/getTodayTotal': 3600 },
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({ totalSeconds: 3600, formatted: '1h' });
  });
});
