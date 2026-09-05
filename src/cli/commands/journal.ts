import type { Argv } from 'yargs';
import { formatJournalBody, formatJournalList } from '../formatters';
import { runCommand, output, say, fail } from '../runtime';
import type { ApiClient } from '../api';

const ID_DESC = 'UUID, prefix, or title substring';

/** Read the whole of stdin — how an agent pipes a note in. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Character offsets for a 1-based line number.
 *
 * The selection actions take offsets, which are hostile to type on a command
 * line, so the CLI addresses lines instead and resolves them against the body
 * it just fetched. The server still expands whatever range it gets to whole
 * lines, so a collapsed offset at the line start is a valid selection.
 */
async function offsetsForLine(
  client: ApiClient,
  journalId: string,
  line: number,
): Promise<{ journalId: string; selectionStart: number; selectionEnd: number }> {
  const journal = await client.journals.getById(journalId);
  if (!journal) fail(`No journal entry with id "${journalId}"`);

  const lines = journal.body.split('\n');
  if (line < 1 || line > lines.length) {
    fail(`Line ${line} is outside the entry (1–${lines.length}). Run "ct journal show <id>" to see it.`);
  }
  if (lines[line - 1].trim() === '') fail(`Line ${line} is blank.`);

  // Offset of the line start: every preceding line plus its newline.
  const start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
  return { journalId: journal.id, selectionStart: start, selectionEnd: start + lines[line - 1].length };
}

export function registerJournalCommands(yargs: Argv): Argv {
  return yargs.command('journal', 'Meeting notes and the to-dos mined from them', (y) =>
    y
      .command(
        'list',
        'List journal entries, newest first',
        (yy) =>
          yy
            .option('search', { type: 'string', nargs: 1, describe: 'Match title or body; prints the matching lines' })
            .option('limit', { type: 'number', describe: 'Maximum entries to return' })
            .option('all', { type: 'boolean', default: false, describe: 'Include deleted entries' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const journals = await client.journals.getAll({
              search: argv.search as string | undefined,
              limit: argv.limit as number | undefined,
              includeDeleted: argv.all as boolean,
            });
            output(argv, journals, formatJournalList);
          }),
      )
      .command(
        'show <id>',
        'Print an entry with numbered lines (the numbers `--line` takes)',
        (yy) => yy.positional('id', { type: 'string', demandOption: true, describe: ID_DESC }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const journal = await client.journals.getById(argv.id as string);
            if (!journal) fail(`No journal entry with id "${argv.id}"`);
            output(argv, journal, (j) => `${j.title || '(untitled)'}\n\n${formatJournalBody(j.body)}`);
          }),
      )
      .command(
        'new [title]',
        'Create an entry; body from --body or stdin',
        (yy) =>
          yy
            .positional('title', { type: 'string' })
            .option('body', { type: 'string', nargs: 1 })
            .option('stdin', { type: 'boolean', default: false, describe: 'Read the body from stdin' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const body = argv.stdin ? await readStdin() : (argv.body as string | undefined);
            const journal = await client.journals.create({
              title: (argv.title as string | undefined) ?? '',
              body: body ?? '',
            });
            output(argv, journal, (j) => `Created journal entry ${j.id.slice(0, 8)}`);
          }),
      )
      .command(
        'edit <id>',
        'Change an entry title or body',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true, describe: ID_DESC })
            // Text starting with "-" needs the `--opt=value` form: yargs reads
            // a space-separated value beginning with a dash as the next flag.
            // `nargs` at least makes that fail loudly instead of silently
            // passing an empty string.
            .option('title', { type: 'string', nargs: 1 })
            .option('body', { type: 'string', nargs: 1, describe: 'Replace the whole body' })
            .option('stdin', { type: 'boolean', default: false, describe: 'Replace the body with stdin' })
            .option('append', { type: 'string', nargs: 1, describe: 'Add text to the end of the body (use --append="- item" for markdown)' })
            .option('date', { type: 'string', nargs: 1, describe: 'When the note was taken, e.g. 2026-09-04 or 2026-09-04T14:30' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const updates: { title?: string; body?: string; createdAt?: string } = {};
            if (argv.title !== undefined) updates.title = argv.title as string;
            if (argv.date !== undefined) {
              // Parsed locally so a typo fails before a round trip; the server
              // validates too, since HTTP callers skip this path.
              const parsed = new Date(argv.date as string);
              if (Number.isNaN(parsed.getTime())) fail(`"${argv.date}" is not a valid date`);
              updates.createdAt = parsed.toISOString();
            }

            if (argv.stdin) {
              updates.body = await readStdin();
            } else if (argv.body !== undefined) {
              updates.body = argv.body as string;
            }

            if (argv.append !== undefined) {
              if (updates.body !== undefined) fail('Use --append or --body/--stdin, not both.');
              const existing = await client.journals.getById(argv.id as string);
              if (!existing) fail(`No journal entry with id "${argv.id}"`);
              const trimmed = existing.body.replace(/\s+$/, '');
              updates.body = trimmed ? `${trimmed}\n${argv.append as string}` : (argv.append as string);
            }

            if (Object.keys(updates).length === 0) fail('Nothing to change. Pass --title, --body, --stdin, --append, or --date.');

            const journal = await client.journals.update(argv.id as string, updates);
            output(argv, journal, (j) => `Updated journal entry ${j.id.slice(0, 8)}`);
          }),
      )
      .command(
        'delete <id>',
        'Move an entry to the recycle bin (restore brings it back)',
        (yy) => yy.positional('id', { type: 'string', demandOption: true, describe: ID_DESC }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            await client.journals.delete(argv.id as string);
            say(`Deleted journal entry ${argv.id}`);
          }),
      )
      .command(
        'restore <id>',
        'Restore a deleted entry',
        (yy) => yy.positional('id', { type: 'string', demandOption: true, describe: 'UUID or prefix' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const journal = await client.journals.restore(argv.id as string);
            output(argv, journal, (j) => `Restored journal entry ${j.id.slice(0, 8)}`);
          }),
      )
      .command(
        'todo <id>',
        'Turn a line into a task and mark that line',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true, describe: ID_DESC })
            .option('line', { type: 'number', demandOption: true, describe: 'Line number from "ct journal show"' })
            .option('title', { type: 'string', nargs: 1, describe: 'Task title (defaults to the line text)' })
            .option('status', { type: 'string', choices: ['todo', 'in-progress', 'done', 'blocked'] })
            .option('source', { type: 'string', choices: ['ad-hoc', 'email', 'meeting-prep'] }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const selection = await offsetsForLine(client, argv.id as string, argv.line as number);
            const result = await client.journals.createTaskFromSelection({
              ...selection,
              title: argv.title as string | undefined,
              status: argv.status as never,
              source: argv.source as never,
            });
            output(argv, result, (r) => `Created task ${r.task.id.slice(0, 8)}  ${r.task.title}`);
          }),
      )
      .command(
        'attach <id>',
        "Append a line to an existing task's notes and mark that line",
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true, describe: ID_DESC })
            .option('line', { type: 'number', demandOption: true, describe: 'Line number from "ct journal show"' })
            .option('task', { type: 'string', demandOption: true, describe: 'Task: UUID, prefix, or name substring' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const selection = await offsetsForLine(client, argv.id as string, argv.line as number);
            const result = await client.journals.appendSelectionToTask({
              ...selection,
              taskId: argv.task as string,
            });
            output(argv, result, (r) => `Appended to task ${r.task.id.slice(0, 8)}  ${r.task.title}`);
          }),
      )
      .command(
        'for-task <task-id>',
        'List the entries a task was mined from',
        (yy) => yy.positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const journals = await client.journals.getByTask(argv['task-id'] as string);
            output(argv, journals, formatJournalList);
          }),
      )
      .demandCommand(1, 'Specify a journal subcommand')
  );
}
