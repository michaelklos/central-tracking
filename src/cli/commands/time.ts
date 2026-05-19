import type { Argv } from 'yargs';
import { formatDuration, formatTimeEntryTable } from '../formatters';
import { runCommand, output, say, fail } from '../runtime';
import { parseDuration } from '../../shared/duration';
import type { CreateTimeEntryInput, UpdateTimeEntryInput } from '../../shared/types';

export function registerTimeCommands(yargs: Argv): Argv {
  return yargs.command('time', 'Manage time entries', (y) =>
    y
      .command(
        'list <task-id>',
        'List time entries for a task',
        (yy) =>
          yy
            .positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' })
            .option('limit', { type: 'number', default: 20 })
            .option('offset', { type: 'number', default: 0 }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const result = await client.timeEntries.getByTaskPaginated(argv['task-id'] as string, {
              offset: argv.offset,
              limit: argv.limit,
            });
            output(argv, result, (r) => {
              const table = formatTimeEntryTable(r.items);
              return r.hasMore
                ? `${table}\n\nShowing ${r.items.length} of ${r.total}. Use --offset to see more.`
                : table;
            });
          }),
      )
      .command(
        'add <task-id>',
        'Add a manual time entry',
        (yy) =>
          yy
            .positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' })
            .option('start', { type: 'string', describe: 'Start time (ISO 8601)' })
            .option('end', { type: 'string', describe: 'End time (ISO 8601)' })
            .option('duration', { type: 'string', describe: 'Duration (e.g., 1h30m, 1:30, 90)' })
            .option('note', { type: 'string', default: '' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const input: CreateTimeEntryInput = {
              taskId: argv['task-id'] as string,
              note: argv.note as string,
            };

            if (argv.duration) {
              const durationSec = parseDuration(argv.duration);
              if (durationSec === null) {
                fail(`Invalid duration "${argv.duration}". Examples: 1h30m, 1:30, 90 (minutes).`);
              }
              if (argv.start) {
                input.startTime = argv.start;
                input.endTime = new Date(new Date(argv.start).getTime() + durationSec * 1000).toISOString();
              } else {
                const endTime = new Date();
                const startTime = new Date(endTime.getTime() - durationSec * 1000);
                input.startTime = startTime.toISOString();
                input.endTime = endTime.toISOString();
              }
            } else if (argv.start && argv.end) {
              input.startTime = argv.start;
              input.endTime = argv.end;
            } else {
              fail('Specify --start and --end, or --duration');
            }

            const entry = await client.timeEntries.create(input);
            output(argv, entry, (e) => `Added time entry ${e.id} (${formatDuration(e.durationSeconds ?? 0)})`);
          }),
      )
      .command(
        'update <id>',
        'Update a time entry',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true })
            .option('start', { type: 'string' })
            .option('end', { type: 'string' })
            .option('note', { type: 'string' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const updates: UpdateTimeEntryInput = {};
            if (argv.start) updates.startTime = argv.start;
            if (argv.end) updates.endTime = argv.end;
            if (argv.note !== undefined) updates.note = argv.note;

            const entry = await client.timeEntries.update(argv.id as string, updates);
            output(argv, entry, (e) => `Updated time entry ${e.id}`);
          }),
      )
      .command(
        'delete <id>',
        'Delete a time entry',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            await client.timeEntries.delete(argv.id as string);
            say(`Deleted time entry ${argv.id}`);
          }),
      )
      .command(
        'today',
        'Show total time tracked today',
        () => {},
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const total = await client.timeEntries.getTodayTotal();
            output(argv, { totalSeconds: total, formatted: formatDuration(total) }, () => `Today: ${formatDuration(total)}`);
          }),
      )
      .command(
        'report <id>',
        'Mark a single time entry as reported externally',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const entry = await client.timeEntries.update(argv.id as string, {
              reportedAt: new Date().toISOString(),
            });
            output(argv, entry, (e) => `Marked entry ${e.id} as reported`);
          }),
      )
      .command(
        'unreport <id>',
        'Mark a single time entry as not yet reported',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const entry = await client.timeEntries.update(argv.id as string, {
              reportedAt: null,
            });
            output(argv, entry, (e) => `Marked entry ${e.id} as unreported`);
          }),
      )
      .command(
        'mark-reported',
        'Bulk mark/unmark reported across many tasks, optionally within a date range',
        (yy) =>
          yy
            .option('tasks', { type: 'string', array: true, demandOption: true, describe: 'Task UUID(s)/prefix(es)' })
            .option('start', { type: 'string', describe: 'Lower-bound date YYYY-MM-DD (inclusive)' })
            .option('end', { type: 'string', describe: 'Upper-bound date YYYY-MM-DD (inclusive end-of-day)' })
            .option('unreported', { type: 'boolean', default: false, describe: 'Clear reportedAt instead of setting it' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const tasks = (argv.tasks as string[]) ?? [];
            if (tasks.length === 0) fail('Specify at least one --tasks <id>.');
            const reportedAt = argv.unreported ? null : new Date().toISOString();
            const result = await client.timeEntries.batchMarkReported(tasks, {
              reportedAt,
              dateStart: argv.start as string | undefined,
              dateEnd: argv.end as string | undefined,
            });
            const verb = argv.unreported ? 'unreported' : 'reported';
            output(argv, result, (r) => `Marked ${r.changed} entr${r.changed === 1 ? 'y' : 'ies'} as ${verb}`);
          }),
      )
      .demandCommand(1, 'Specify a time subcommand')
  );
}
