import type { Argv } from 'yargs';
import { formatDuration } from '../formatters';
import { runCommand, output, say } from '../runtime';

export function registerTimerCommands(yargs: Argv): Argv {
  return yargs.command('timer', 'Control the timer', (y) =>
    y
      .command(
        'start <task-id>',
        'Start timer for a task',
        (yy) => yy.positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const entry = await client.timeEntries.create({ taskId: argv['task-id'] as string });
            output(argv, entry, (e) => `Timer started for task ${e.taskId} (entry ${e.id})`);
          }),
      )
      .command(
        'stop',
        'Stop the active timer',
        () => {},
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const entry = await client.timeEntries.stopActive();
            if (!entry) {
              say('No active timer.');
              return;
            }
            output(argv, entry, (e) => `Timer stopped. Duration: ${formatDuration(e.durationSeconds ?? 0)}`);
          }),
      )
      .command(
        'status',
        'Show active timer',
        () => {},
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const entry = await client.timeEntries.getActive();
            if (!entry) {
              say('No active timer.');
              return;
            }
            const elapsedSeconds = Math.floor((Date.now() - new Date(entry.startTime).getTime()) / 1000);
            output(argv, { ...entry, elapsedSeconds }, (e) =>
              [
                `Task:    ${e.taskId}`,
                `Started: ${e.startTime}`,
                `Elapsed: ${formatDuration(elapsedSeconds)}`,
              ].join('\n'),
            );
          }),
      )
      .demandCommand(1, 'Specify a timer subcommand')
  );
}
