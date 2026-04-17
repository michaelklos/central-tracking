import { describe, it, expect } from 'vitest';
import { runCli } from './harness';
import { registerStatusCommands } from '../../commands/status';

describe('ct status', () => {
  it('running + no active timer', async () => {
    const { stdout } = await runCli(registerStatusCommands, ['status'], {
      responses: {
        'timeEntries/getActive': null,
        'timeEntries/getTodayTotal': 0,
      },
    });
    expect(stdout).toContain('Central Tracking is running');
    expect(stdout).toContain('No active timer.');
    expect(stdout).toContain('Today: 0m');
  });

  it('running + active timer reports taskId', async () => {
    const active = {
      id: 'entry-1',
      taskId: 'task-xyz',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: null,
      durationSeconds: null,
      note: '',
      createdAt: new Date().toISOString(),
    };
    const { stdout } = await runCli(registerStatusCommands, ['status'], {
      responses: {
        'timeEntries/getActive': active,
        'timeEntries/getTodayTotal': 120,
      },
    });
    expect(stdout).toContain('Active timer: task task-xyz');
  });

  it('server down — human output', async () => {
    const { stdout, exitCode } = await runCli(registerStatusCommands, ['status'], {
      serverDown: true,
    });
    expect(exitCode).toBeNull();
    expect(stdout).toContain('Central Tracking is not running');
  });

  it('server down — --json emits { running: false }', async () => {
    const { stdout } = await runCli(registerStatusCommands, ['status', '--json'], {
      serverDown: true,
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({ running: false });
  });

  it('--json includes todayTotalSeconds', async () => {
    const { stdout } = await runCli(registerStatusCommands, ['status', '--json'], {
      responses: {
        'timeEntries/getActive': null,
        'timeEntries/getTodayTotal': 7200,
      },
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.running).toBe(true);
    expect(parsed.todayTotalSeconds).toBe(7200);
  });
});

describe('ct version', () => {
  it('prints "ct <version>"', async () => {
    const { stdout } = await runCli(registerStatusCommands, ['version'], { responses: {} });
    expect(stdout).toMatch(/^ct \d+\.\d+\.\d+/);
  });
});
