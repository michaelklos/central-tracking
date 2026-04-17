import * as fs from 'fs';
import type { Argv } from 'yargs';
import { formatSummaryReport, formatTimeEntryTable } from '../formatters';
import { runCommand, output, say } from '../runtime';
import { toIsoStartOfDay, toIsoEndOfDay } from '../../shared/dateRange';

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
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const start = toIsoStartOfDay(argv.from);
            const end = toIsoEndOfDay(argv.to);
            const entries = await client.timeEntries.getSummaryReport(start, end);
            output(argv, entries, formatSummaryReport);
          }),
      )
      .command(
        'detail',
        'Detailed per-entry report',
        (yy) =>
          yy
            .option('from', { type: 'string', demandOption: true })
            .option('to', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const start = toIsoStartOfDay(argv.from);
            const end = toIsoEndOfDay(argv.to);
            const entries = await client.timeEntries.getByDateRangeWithTasks(start, end);
            const withNotes = entries.map((e) => ({ ...e, note: e.note || e.taskTitle }));
            output(argv, entries, () => formatTimeEntryTable(withNotes));
          }),
      )
      .command(
        'chart',
        'Chart data (date x task x seconds)',
        (yy) =>
          yy
            .option('from', { type: 'string', demandOption: true })
            .option('to', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const start = toIsoStartOfDay(argv.from);
            const end = toIsoEndOfDay(argv.to);
            const data = await client.timeEntries.getReport(start, end);
            // Chart data is always JSON (meant for programmatic consumption).
            process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
          }),
      )
      .command(
        'export',
        'Export CSV report',
        (yy) =>
          yy
            .option('from', { type: 'string', demandOption: true })
            .option('to', { type: 'string', demandOption: true })
            .option('out', { type: 'string', describe: 'Output file path (default: stdout)' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const start = toIsoStartOfDay(argv.from);
            const end = toIsoEndOfDay(argv.to);
            const csv = await client.reports.generateCsv(start, end);
            if (argv.out) {
              fs.writeFileSync(argv.out, csv, 'utf-8');
              process.stderr.write(`Exported to ${argv.out}\n`);
            } else {
              say(csv);
            }
          }),
      )
      .demandCommand(1, 'Specify a report subcommand')
  );
}
