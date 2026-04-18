import { describe, it, expect } from 'vitest';
import { runCli } from './harness';
import { registerTimerCommands } from '../../commands/timer';

const sampleEntry = {
  id: 'entry-1',
  taskId: 'task-1',
  startTime: '2026-04-17T10:00:00.000Z',
  endTime: null,
  durationSeconds: null,
  note: '',
  createdAt: '2026-04-17T10:00:00.000Z',
};

describe('ct timer start', () => {
  it('calls timeEntries/create with taskId', async () => {
    const { calls, stdout, exitCode } = await runCli(
      registerTimerCommands,
      ['timer', 'start', 'task-1'],
      { responses: { 'timeEntries/create': sampleEntry } },
    );
    expect(exitCode).toBeNull();
    expect(calls).toEqual([{ endpoint: 'timeEntries/create', args: [{ taskId: 'task-1' }] }]);
    expect(stdout).toContain('Timer started for task task-1');
  });
});

describe('ct timer stop', () => {
  it('reports duration when active timer was running', async () => {
    const stopped = { ...sampleEntry, endTime: '2026-04-17T10:30:00.000Z', durationSeconds: 1800 };
    const { calls, stdout } = await runCli(registerTimerCommands, ['timer', 'stop'], {
      responses: { 'timeEntries/stopActive': stopped },
    });
    expect(calls).toEqual([{ endpoint: 'timeEntries/stopActive', args: [] }]);
    expect(stdout).toContain('Duration: 30m');
  });

  it('prints "No active timer." when nothing was running', async () => {
    const { stdout } = await runCli(registerTimerCommands, ['timer', 'stop'], {
      responses: { 'timeEntries/stopActive': null },
    });
    expect(stdout).toContain('No active timer');
  });
});

describe('ct timer status', () => {
  it('prints task + elapsed when active', async () => {
    const { stdout } = await runCli(registerTimerCommands, ['timer', 'status'], {
      responses: { 'timeEntries/getActive': sampleEntry },
    });
    expect(stdout).toContain('Task:    task-1');
    expect(stdout).toContain('Started: 2026-04-17T10:00:00.000Z');
    expect(stdout).toMatch(/Elapsed: /);
  });

  it('says "No active timer." when inactive', async () => {
    const { stdout } = await runCli(registerTimerCommands, ['timer', 'status'], {
      responses: { 'timeEntries/getActive': null },
    });
    expect(stdout.trim()).toBe('No active timer.');
  });

  it('emits JSON including elapsedSeconds when --json', async () => {
    const { stdout } = await runCli(registerTimerCommands, ['timer', 'status', '--json'], {
      responses: { 'timeEntries/getActive': sampleEntry },
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.id).toBe('entry-1');
    expect(typeof parsed.elapsedSeconds).toBe('number');
  });
});
