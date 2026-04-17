import type { Argv } from 'yargs';
import { discoverServer, apiRequest } from '../client';
import { formatDuration } from '../formatters';
import type { TimeEntry } from '../../shared/types';

export function registerTimerCommands(yargs: Argv): Argv {
  return yargs.command('timer', 'Control the timer', (y) =>
    y
      .command(
        'start <task-id>',
        'Start timer for a task',
        (yy) => yy.positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' }),
        async (argv) => {
          const server = discoverServer();
          const entry = await apiRequest<TimeEntry>(server, 'timeEntries/create', [
            { taskId: argv['task-id'] },
          ]);
          if (argv.json) {
            console.log(JSON.stringify(entry, null, 2));
          } else {
            console.log(`Timer started for task ${entry.taskId} (entry ${entry.id})`);
          }
        },
      )
      .command(
        'stop',
        'Stop the active timer',
        () => {},
        async (argv) => {
          const server = discoverServer();
          const entry = await apiRequest<TimeEntry | null>(server, 'timeEntries/stopActive');
          if (!entry) {
            console.log('No active timer.');
            return;
          }
          if (argv.json) {
            console.log(JSON.stringify(entry, null, 2));
          } else {
            console.log(`Timer stopped. Duration: ${formatDuration(entry.durationSeconds ?? 0)}`);
          }
        },
      )
      .command(
        'status',
        'Show active timer',
        () => {},
        async (argv) => {
          const server = discoverServer();
          const entry = await apiRequest<TimeEntry | null>(server, 'timeEntries/getActive');
          if (!entry) {
            console.log('No active timer.');
            return;
          }
          const elapsed = Math.floor((Date.now() - new Date(entry.startTime).getTime()) / 1000);
          if (argv.json) {
            console.log(JSON.stringify({ ...entry, elapsedSeconds: elapsed }, null, 2));
          } else {
            console.log(`Task:    ${entry.taskId}`);
            console.log(`Started: ${entry.startTime}`);
            console.log(`Elapsed: ${formatDuration(elapsed)}`);
          }
        },
      )
      .demandCommand(1, 'Specify a timer subcommand')
  );
}
