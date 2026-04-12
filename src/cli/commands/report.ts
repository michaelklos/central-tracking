import * as fs from 'fs';
import type { Argv } from 'yargs';
import { discoverServer, apiRequest } from '../client';
import { formatSummaryReport, formatTimeEntryTable } from '../formatters';

interface SummaryReportEntry {
  date: string;
  taskId: string;
  taskTitle: string;
  taskSource: string;
  taskStatus: string;
  categoryIds: string[];
  totalSeconds: number;
}

interface TimeEntryReport {
  date: string;
  taskId: string;
  taskTitle: string;
  totalSeconds: number;
}

interface TimeEntryWithTask {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  note: string;
  taskTitle: string;
  taskSource: string;
}

export function registerReportCommands(yargs: Argv): Argv {
  return yargs.command('report', 'Generate reports', (y) =>
    y
      .command(
        'summary',
        'Plain text summary report grouped by date',
        (yy) =>
          yy
            .option('from', { type: 'string', demandOption: true, describe: 'Start date (YYYY-MM-DD)' })
            .option('to', { type: 'string', demandOption: true, describe: 'End date (YYYY-MM-DD)' }),
        async (argv) => {
          const server = discoverServer();
          const start = `${argv.from}T00:00:00.000Z`;
          const end = `${argv.to}T23:59:59.999Z`;
          const entries = await apiRequest<SummaryReportEntry[]>(server, 'timeEntries/getSummaryReport', [start, end]);
          if (argv.json) {
            console.log(JSON.stringify(entries, null, 2));
          } else {
            console.log(formatSummaryReport(entries));
          }
        },
      )
      .command(
        'detail',
        'Detailed per-entry report',
        (yy) =>
          yy
            .option('from', { type: 'string', demandOption: true })
            .option('to', { type: 'string', demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          const start = `${argv.from}T00:00:00.000Z`;
          const end = `${argv.to}T23:59:59.999Z`;
          const entries = await apiRequest<TimeEntryWithTask[]>(server, 'timeEntries/getByDateRangeWithTasks', [start, end]);
          if (argv.json) {
            console.log(JSON.stringify(entries, null, 2));
          } else {
            const withNotes = entries.map((e) => ({
              ...e,
              note: e.note || e.taskTitle,
            }));
            console.log(formatTimeEntryTable(withNotes));
          }
        },
      )
      .command(
        'chart',
        'Chart data (date x task x seconds)',
        (yy) =>
          yy
            .option('from', { type: 'string', demandOption: true })
            .option('to', { type: 'string', demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          const start = `${argv.from}T00:00:00.000Z`;
          const end = `${argv.to}T23:59:59.999Z`;
          const data = await apiRequest<TimeEntryReport[]>(server, 'timeEntries/getReport', [start, end]);
          // Chart data is always JSON (it's meant for programmatic consumption)
          console.log(JSON.stringify(data, null, 2));
        },
      )
      .command(
        'export',
        'Export CSV report',
        (yy) =>
          yy
            .option('from', { type: 'string', demandOption: true })
            .option('to', { type: 'string', demandOption: true })
            .option('out', { type: 'string', describe: 'Output file path (default: stdout)' }),
        async (argv) => {
          const server = discoverServer();
          const start = `${argv.from}T00:00:00.000Z`;
          const end = `${argv.to}T23:59:59.999Z`;
          const csv = await apiRequest<string>(server, 'reports/generateCsv', [start, end]);
          if (argv.out) {
            fs.writeFileSync(argv.out, csv, 'utf-8');
            console.error(`Exported to ${argv.out}`);
          } else {
            console.log(csv);
          }
        },
      )
      .demandCommand(1, 'Specify a report subcommand')
  );
}
