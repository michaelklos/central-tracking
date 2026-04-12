import type { Argv } from 'yargs';
import { discoverServer, apiRequest } from '../client';
import { formatTaskTable } from '../formatters';

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  source: string;
  totalTimeSeconds: number;
  todayTimeSeconds: number;
  categoryIds: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedResponse {
  items: Task[];
  total: number;
  hasMore: boolean;
}

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
            .option('status', { type: 'string', describe: 'Filter by status' })
            .option('sort', { type: 'string', describe: 'Sort: manual|recent|created|alphabetical|most-time-today' })
            .option('limit', { type: 'number', default: 50, describe: 'Max results' })
            .option('offset', { type: 'number', default: 0, describe: 'Skip results' }),
        async (argv) => {
          const server = discoverServer();
          const json = argv.json as boolean;
          let endpoint: string;
          let args: unknown[];

          if (argv.all) {
            const result = await apiRequest<Task[]>(server, 'tasks/getAll');
            if (json) {
              console.log(JSON.stringify(result, null, 2));
            } else {
              console.log(formatTaskTable(result));
            }
            return;
          }

          const params = { offset: argv.offset, limit: argv.limit, sortBy: argv.sort };

          if (argv.deleted) {
            endpoint = 'tasks/getDeleted';
            args = [{ offset: argv.offset, limit: argv.limit }];
          } else if (argv.done) {
            endpoint = 'tasks/getDone';
            args = [params];
          } else {
            endpoint = 'tasks/getActive';
            args = [params];
          }

          const result = await apiRequest<PaginatedResponse>(server, endpoint, args);
          if (json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatTaskTable(result.items));
            if (result.hasMore) {
              console.log(`\nShowing ${result.items.length} of ${result.total} tasks. Use --offset to see more.`);
            }
          }
        },
      )
      .command(
        'get <id>',
        'Get a task by ID',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          const task = await apiRequest<Task | null>(server, 'tasks/getById', [argv.id]);
          if (!task) {
            console.error(`Task ${argv.id} not found.`);
            process.exit(1);
          }
          if (argv.json) {
            console.log(JSON.stringify(task, null, 2));
          } else {
            console.log(`ID:          ${task.id}`);
            console.log(`Title:       ${task.title}`);
            console.log(`Status:      ${task.status}`);
            console.log(`Source:      ${task.source}`);
            console.log(`Description: ${task.description || '(none)'}`);
            console.log(`Notes:       ${task.notes || '(none)'}`);
            console.log(`Categories:  ${task.categoryIds.length > 0 ? task.categoryIds.join(', ') : '(none)'}`);
            console.log(`Created:     ${task.createdAt}`);
            console.log(`Updated:     ${task.updatedAt}`);
          }
        },
      )
      .command(
        'create <title>',
        'Create a new task',
        (yy) =>
          yy
            .positional('title', { type: 'string', demandOption: true })
            .option('description', { type: 'string', alias: 'd' })
            .option('status', { type: 'string', choices: ['todo', 'in-progress', 'done', 'blocked'] as const })
            .option('source', { type: 'string', choices: ['ad-hoc', 'email', 'meeting-prep', 'plugin'] as const })
            .option('category', { type: 'string', array: true, describe: 'Category ID(s)' }),
        async (argv) => {
          const server = discoverServer();
          const input: Record<string, unknown> = { title: argv.title };
          if (argv.description) input.description = argv.description;
          if (argv.status) input.status = argv.status;
          if (argv.source) input.source = argv.source;
          if (argv.category) input.categoryIds = argv.category;

          const task = await apiRequest<Task>(server, 'tasks/create', [input]);
          if (argv.json) {
            console.log(JSON.stringify(task, null, 2));
          } else {
            console.log(`Created task ${task.id} — "${task.title}"`);
          }
        },
      )
      .command(
        'update <id>',
        'Update a task',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true })
            .option('title', { type: 'string' })
            .option('description', { type: 'string', alias: 'd' })
            .option('status', { type: 'string', choices: ['todo', 'in-progress', 'done', 'blocked'] as const })
            .option('source', { type: 'string', choices: ['ad-hoc', 'email', 'meeting-prep', 'plugin'] as const })
            .option('notes', { type: 'string' })
            .option('category', { type: 'string', array: true, describe: 'Category ID(s)' }),
        async (argv) => {
          const server = discoverServer();
          const updates: Record<string, unknown> = {};
          if (argv.title) updates.title = argv.title;
          if (argv.description !== undefined) updates.description = argv.description;
          if (argv.status) updates.status = argv.status;
          if (argv.source) updates.source = argv.source;
          if (argv.notes !== undefined) updates.notes = argv.notes;
          if (argv.category) updates.categoryIds = argv.category;

          const task = await apiRequest<Task>(server, 'tasks/update', [argv.id, updates]);
          if (argv.json) {
            console.log(JSON.stringify(task, null, 2));
          } else {
            console.log(`Updated task ${task.id}`);
          }
        },
      )
      .command(
        'delete <ids..>',
        'Soft-delete task(s)',
        (yy) => yy.positional('ids', { type: 'string', array: true, demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          const ids = argv.ids as string[];
          if (ids.length === 1) {
            await apiRequest(server, 'tasks/delete', [ids[0]]);
            console.log(`Deleted task ${ids[0]}`);
          } else {
            const result = await apiRequest<{ deletedCount: number }>(server, 'tasks/batchSoftDelete', [ids]);
            console.log(`Deleted ${result.deletedCount} tasks`);
          }
        },
      )
      .command(
        'restore <ids..>',
        'Restore deleted task(s)',
        (yy) => yy.positional('ids', { type: 'string', array: true, demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          const ids = argv.ids as string[];
          if (ids.length === 1) {
            const task = await apiRequest<Task>(server, 'tasks/restore', [ids[0]]);
            if (argv.json) {
              console.log(JSON.stringify(task, null, 2));
            } else {
              console.log(`Restored task "${task.title}"`);
            }
          } else {
            const result = await apiRequest<{ restoredCount: number }>(server, 'tasks/batchRestore', [ids]);
            console.log(`Restored ${result.restoredCount} tasks`);
          }
        },
      )
      .command(
        'purge',
        'Permanently delete task(s)',
        (yy) =>
          yy
            .option('all', { type: 'boolean', describe: 'Empty recycle bin' })
            .option('id', { type: 'string', describe: 'Task ID to purge' }),
        async (argv) => {
          const server = discoverServer();
          if (argv.all) {
            await apiRequest(server, 'tasks/emptyRecycleBin');
            console.log('Recycle bin emptied.');
          } else if (argv.id) {
            await apiRequest(server, 'tasks/purgeDeleted', [argv.id]);
            console.log(`Purged task ${argv.id}`);
          } else {
            console.error('Specify --id <taskId> or --all');
            process.exit(1);
          }
        },
      )
      .command(
        'reorder <ids..>',
        'Set task sort order',
        (yy) => yy.positional('ids', { type: 'string', array: true, demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          await apiRequest(server, 'tasks/reorder', [argv.ids]);
          console.log(`Reordered ${(argv.ids as string[]).length} tasks`);
        },
      )
      .command(
        'batch-update <ids..>',
        'Batch update tasks',
        (yy) =>
          yy
            .positional('ids', { type: 'string', array: true, demandOption: true })
            .option('status', { type: 'string', choices: ['todo', 'in-progress', 'done', 'blocked'] as const })
            .option('source', { type: 'string', choices: ['ad-hoc', 'email', 'meeting-prep', 'plugin'] as const })
            .option('category', { type: 'string', array: true }),
        async (argv) => {
          const server = discoverServer();
          const input: Record<string, unknown> = {};
          if (argv.status) input.status = argv.status;
          if (argv.source) input.source = argv.source;
          if (argv.category) input.categoryIds = argv.category;

          const ids = argv.ids as string[];
          const result = await apiRequest<{ updatedCount: number }>(server, 'tasks/batchUpdate', [ids, input]);
          console.log(`Updated ${result.updatedCount} tasks`);
        },
      )
      .demandCommand(1, 'Specify a task subcommand')
  );
}
