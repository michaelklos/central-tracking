import type { Argv } from 'yargs';
import { formatTaskTable } from '../formatters';
import { runCommand, output, say, fail } from '../runtime';
import { TASK_STATUSES, TASK_SOURCES } from '../../shared/types';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  BatchUpdateInput,
  TaskQueryParams,
  TaskStatus,
  TaskSource,
} from '../../shared/types';

export function registerTaskCommands(yargs: Argv): Argv {
  return yargs.command('task', 'Manage tasks', (y) =>
    y
      .command(
        'list',
        'List tasks',
        (yy) =>
          yy
            .option('done', { type: 'boolean', describe: 'Show completed tasks' })
            .option('deleted', { type: 'boolean', describe: 'Show deleted tasks (recycle bin)' })
            .option('all', { type: 'boolean', describe: 'Show all tasks' })
            .option('search', { type: 'string', alias: 's', describe: 'Search title and description' })
            .option('status', { type: 'string', describe: 'Filter by status' })
            .option('source', { type: 'string', describe: 'Filter by source' })
            .option('category', { type: 'string', describe: 'Filter by category ID' })
            .option('sort', { type: 'string', describe: 'Sort: manual|recent|created|alphabetical|most-time-today' })
            .option('limit', { type: 'number', default: 50, describe: 'Max results' })
            .option('offset', { type: 'number', default: 0, describe: 'Skip results' })
            .option('full-id', { type: 'boolean', default: false, describe: 'Show full UUID instead of prefix' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const fullId = argv['full-id'] as boolean;

            if (argv.all) {
              const tasks = await client.tasks.getAll();
              output(argv, tasks, (t) => formatTaskTable(t, { fullId }));
              return;
            }

            const params: TaskQueryParams = {
              offset: argv.offset,
              limit: argv.limit,
              sortBy: argv.sort as TaskQueryParams['sortBy'],
            };
            if (argv.search) params.search = argv.search;
            if (argv.status) params.status = argv.status;
            if (argv.source) params.source = argv.source;
            if (argv.category) params.categoryId = argv.category;

            const result = argv.deleted
              ? await client.tasks.getDeleted({ offset: argv.offset, limit: argv.limit })
              : argv.done
                ? await client.tasks.getDone(params)
                : await client.tasks.getActive(params);

            output(argv, result, (r) => {
              const table = formatTaskTable(r.items, { fullId });
              return r.hasMore
                ? `${table}\n\nShowing ${r.items.length} of ${r.total} tasks. Use --offset to see more.`
                : table;
            });
          }),
      )
      .command(
        'get <id>',
        'Get a task by ID',
        (yy) => yy.positional('id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const task = await client.tasks.getById(argv.id as string);
            if (!task) fail(`Task ${argv.id} not found.`);
            output(argv, task, (t) => [
              `ID:          ${t.id}`,
              `Title:       ${t.title}`,
              `Status:      ${t.status}`,
              `Source:      ${t.source}`,
              `Description: ${t.description || '(none)'}`,
              `Notes:       ${t.notes || '(none)'}`,
              `Categories:  ${t.categoryIds.length > 0 ? t.categoryIds.join(', ') : '(none)'}`,
              `Created:     ${t.createdAt}`,
              `Updated:     ${t.updatedAt}`,
            ].join('\n'));
          }),
      )
      .command(
        'create <title>',
        'Create a new task',
        (yy) =>
          yy
            .positional('title', { type: 'string', demandOption: true })
            .option('description', { type: 'string', alias: 'd' })
            .option('status', { type: 'string', choices: TASK_STATUSES })
            .option('source', { type: 'string', choices: TASK_SOURCES })
            .option('category', { type: 'string', array: true, describe: 'Category ID(s)' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const input: CreateTaskInput = { title: argv.title as string };
            if (argv.description) input.description = argv.description;
            if (argv.status) input.status = argv.status as TaskStatus;
            if (argv.source) input.source = argv.source as TaskSource;
            if (argv.category) input.categoryIds = argv.category as string[];

            const task = await client.tasks.create(input);
            output(argv, task, (t) => `Created task ${t.id} — "${t.title}"`);
          }),
      )
      .command(
        'update <id>',
        'Update a task',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' })
            .option('title', { type: 'string' })
            .option('description', { type: 'string', alias: 'd' })
            .option('status', { type: 'string', choices: TASK_STATUSES })
            .option('source', { type: 'string', choices: TASK_SOURCES })
            .option('notes', { type: 'string' })
            .option('category', { type: 'string', array: true, describe: 'Category ID(s)' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const updates: UpdateTaskInput = {};
            if (argv.title) updates.title = argv.title;
            if (argv.description !== undefined) updates.description = argv.description;
            if (argv.status) updates.status = argv.status as TaskStatus;
            if (argv.source) updates.source = argv.source as TaskSource;
            if (argv.notes !== undefined) updates.notes = argv.notes;
            if (argv.category) updates.categoryIds = argv.category as string[];

            const task = await client.tasks.update(argv.id as string, updates);
            output(argv, task, (t) => `Updated task ${t.id}`);
          }),
      )
      .command(
        'delete <ids..>',
        'Soft-delete task(s)',
        (yy) => yy.positional('ids', { type: 'string', array: true, demandOption: true, describe: 'UUID(s), prefix(es), or name(s)' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const ids = argv.ids as string[];
            if (ids.length === 1) {
              await client.tasks.delete(ids[0]);
              say(`Deleted task ${ids[0]}`);
            } else {
              const result = await client.tasks.batchSoftDelete(ids);
              say(`Deleted ${result.deletedCount} tasks`);
            }
          }),
      )
      .command(
        'restore <ids..>',
        'Restore deleted task(s)',
        (yy) => yy.positional('ids', { type: 'string', array: true, demandOption: true, describe: 'UUID(s), prefix(es), or name(s)' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const ids = argv.ids as string[];
            if (ids.length === 1) {
              const task = await client.tasks.restore(ids[0]);
              output(argv, task, (t) => `Restored task "${t.title}"`);
            } else {
              const result = await client.tasks.batchRestore(ids);
              say(`Restored ${result.restoredCount} tasks`);
            }
          }),
      )
      .command(
        'purge',
        'Permanently delete task(s)',
        (yy) =>
          yy
            .option('all', { type: 'boolean', describe: 'Empty recycle bin' })
            .option('id', { type: 'string', describe: 'UUID, prefix, or name substring' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            if (argv.all) {
              await client.tasks.emptyRecycleBin();
              say('Recycle bin emptied.');
            } else if (argv.id) {
              await client.tasks.purgeDeleted(argv.id);
              say(`Purged task ${argv.id}`);
            } else {
              fail('Specify --id <taskId> or --all');
            }
          }),
      )
      .command(
        'reorder <ids..>',
        'Set task sort order',
        (yy) => yy.positional('ids', { type: 'string', array: true, demandOption: true, describe: 'UUID(s), prefix(es), or name(s)' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const ids = argv.ids as string[];
            await client.tasks.reorder(ids);
            say(`Reordered ${ids.length} tasks`);
          }),
      )
      .command(
        'batch-update <ids..>',
        'Batch update tasks',
        (yy) =>
          yy
            .positional('ids', { type: 'string', array: true, demandOption: true, describe: 'UUID(s), prefix(es), or name(s)' })
            .option('status', { type: 'string', choices: TASK_STATUSES })
            .option('source', { type: 'string', choices: TASK_SOURCES })
            .option('category', { type: 'string', array: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const input: BatchUpdateInput = {};
            if (argv.status) input.status = argv.status as TaskStatus;
            if (argv.source) input.source = argv.source as TaskSource;
            if (argv.category) input.categoryIds = argv.category as string[];

            const ids = argv.ids as string[];
            const result = await client.tasks.batchUpdate(ids, input);
            say(`Updated ${result.updatedCount} tasks`);
          }),
      )
      .demandCommand(1, 'Specify a task subcommand')
  );
}
