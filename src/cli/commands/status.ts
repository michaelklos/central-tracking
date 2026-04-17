import type { Argv } from 'yargs';
import { formatDuration } from '../formatters';
import { discoverServer, apiRequest } from '../client';
import { createApiClient } from '../api';
import { say } from '../runtime';
import type { TimeEntry } from '../../shared/types';

interface StatusPayload {
  running: boolean;
  port?: number;
  activeTimer: { taskId: string; startTime: string; elapsedSeconds: number } | null;
  todayTotalSeconds: number;
}

function emitStatus(argv: { json: boolean }, payload: StatusPayload, entry: TimeEntry | null): void {
  if (argv.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  say(`Central Tracking is running (port ${payload.port})`);
  if (entry && payload.activeTimer) {
    say(`Active timer: task ${entry.taskId} (${formatDuration(payload.activeTimer.elapsedSeconds)})`);
  } else {
    say('No active timer.');
  }
  say(`Today: ${formatDuration(payload.todayTotalSeconds)}`);
}

export function registerStatusCommands(yargs: Argv): Argv {
  return yargs
    .command(
      'status',
      'Show app status',
      () => {},
      async (argv) => {
        const g = argv as unknown as { json: boolean; debug: boolean; timeout: number };
        let server;
        try {
          server = discoverServer();
        } catch {
          if (g.json) {
            process.stdout.write(`${JSON.stringify({ running: false })}\n`);
          } else {
            say('Central Tracking is not running.');
          }
          return;
        }

        const opts = { timeoutMs: Math.max(1, g.timeout) * 1000, debug: g.debug };
        const request = <T>(endpoint: string, args: unknown[] = []) =>
          apiRequest<T>(server, endpoint, args, opts);
        const client = createApiClient(request);

        try {
          const [active, todayTotal] = await Promise.all([
            client.timeEntries.getActive(),
            client.timeEntries.getTodayTotal(),
          ]);

          const payload: StatusPayload = {
            running: true,
            port: server.port,
            activeTimer: active
              ? {
                  taskId: active.taskId,
                  startTime: active.startTime,
                  elapsedSeconds: Math.floor((Date.now() - new Date(active.startTime).getTime()) / 1000),
                }
              : null,
            todayTotalSeconds: todayTotal,
          };

          emitStatus(g, payload, active);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`${message}\n`);
          process.exit(1);
        }
      },
    )
    .command(
      'version',
      'Show version',
      () => {},
      () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pkg = require('../../../package.json');
        say(`ct ${pkg.version}`);
      },
    );
}
