import type { Argv } from 'yargs';
import { discoverServer, apiRequest } from '../client';
import { formatDuration, formatTimeEntryTable } from '../formatters';

interface TimeEntry {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  note: string;
}

interface PaginatedResponse {
  items: TimeEntry[];
  total: number;
  hasMore: boolean;
}

function parseDuration(durationStr: string): number {
  let total = 0;
  const hourMatch = durationStr.match(/(\d+)h/);
  const minMatch = durationStr.match(/(\d+)m/);
  const secMatch = durationStr.match(/(\d+)s/);
  if (hourMatch) total += parseInt(hourMatch[1]) * 3600;
  if (minMatch) total += parseInt(minMatch[1]) * 60;
  if (secMatch) total += parseInt(secMatch[1]);
  return total;
}

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
        async (argv) => {
          const server = discoverServer();
          const result = await apiRequest<PaginatedResponse>(server, 'timeEntries/getByTaskPaginated', [
            argv['task-id'],
            { offset: argv.offset, limit: argv.limit },
          ]);
          if (argv.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatTimeEntryTable(result.items));
            if (result.hasMore) {
              console.log(`\nShowing ${result.items.length} of ${result.total}. Use --offset to see more.`);
            }
          }
        },
      )
      .command(
        'add <task-id>',
        'Add a manual time entry',
        (yy) =>
          yy
            .positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' })
            .option('start', { type: 'string', describe: 'Start time (ISO 8601)' })
            .option('end', { type: 'string', describe: 'End time (ISO 8601)' })
            .option('duration', { type: 'string', describe: 'Duration (e.g., 1h30m)' })
            .option('note', { type: 'string', default: '' }),
        async (argv) => {
          const server = discoverServer();
          const input: Record<string, unknown> = { taskId: argv['task-id'], note: argv.note };

          if (argv.duration) {
            const durationSec = parseDuration(argv.duration);
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
            console.error('Specify --start and --end, or --duration');
            process.exit(1);
          }

          const entry = await apiRequest<TimeEntry>(server, 'timeEntries/create', [input]);
          if (argv.json) {
            console.log(JSON.stringify(entry, null, 2));
          } else {
            console.log(`Added time entry ${entry.id} (${formatDuration(entry.durationSeconds ?? 0)})`);
          }
        },
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
        async (argv) => {
          const server = discoverServer();
          const updates: Record<string, unknown> = {};
          if (argv.start) updates.startTime = argv.start;
          if (argv.end) updates.endTime = argv.end;
          if (argv.note !== undefined) updates.note = argv.note;

          const entry = await apiRequest<TimeEntry>(server, 'timeEntries/update', [argv.id, updates]);
          if (argv.json) {
            console.log(JSON.stringify(entry, null, 2));
          } else {
            console.log(`Updated time entry ${entry.id}`);
          }
        },
      )
      .command(
        'delete <id>',
        'Delete a time entry',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          await apiRequest(server, 'timeEntries/delete', [argv.id]);
          console.log(`Deleted time entry ${argv.id}`);
        },
      )
      .command(
        'today',
        'Show total time tracked today',
        () => {},
        async (argv) => {
          const server = discoverServer();
          const total = await apiRequest<number>(server, 'timeEntries/getTodayTotal');
          if (argv.json) {
            console.log(JSON.stringify({ totalSeconds: total, formatted: formatDuration(total) }));
          } else {
            console.log(`Today: ${formatDuration(total)}`);
          }
        },
      )
      .demandCommand(1, 'Specify a time subcommand')
  );
}
