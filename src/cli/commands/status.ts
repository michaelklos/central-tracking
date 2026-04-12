import type { Argv } from 'yargs';
import { discoverServer, apiRequest } from '../client';
import { formatDuration } from '../formatters';

interface TimeEntry {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  note: string;
}

export function registerStatusCommands(yargs: Argv): Argv {
  return yargs
    .command(
      'status',
      'Show app status',
      () => {},
      async (argv) => {
        let server;
        try {
          server = discoverServer();
        } catch {
          if (argv.json) {
            console.log(JSON.stringify({ running: false }));
          } else {
            console.log('Central Tracking is not running.');
          }
          return;
        }

        const [active, todayTotal] = await Promise.all([
          apiRequest<TimeEntry | null>(server, 'timeEntries/getActive'),
          apiRequest<number>(server, 'timeEntries/getTodayTotal'),
        ]);

        if (argv.json) {
          console.log(
            JSON.stringify({
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
            }, null, 2),
          );
        } else {
          console.log(`Central Tracking is running (port ${server.port})`);
          if (active) {
            const elapsed = Math.floor((Date.now() - new Date(active.startTime).getTime()) / 1000);
            console.log(`Active timer: task ${active.taskId} (${formatDuration(elapsed)})`);
          } else {
            console.log('No active timer.');
          }
          console.log(`Today: ${formatDuration(todayTotal)}`);
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
        console.log(`ct ${pkg.version}`);
      },
    );
}
