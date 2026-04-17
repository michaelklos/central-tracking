import type { Argv } from 'yargs';
import { discoverServer, apiRequest } from '../client';
import { formatCategoryList } from '../formatters';
import type { Category } from '../../shared/types';

export function registerCategoryCommands(yargs: Argv): Argv {
  return yargs.command('category', 'Manage categories', (y) =>
    y
      .command(
        'list',
        'List all categories',
        () => {},
        async (argv) => {
          const server = discoverServer();
          const categories = await apiRequest<Category[]>(server, 'categories/getAll');
          if (argv.json) {
            console.log(JSON.stringify(categories, null, 2));
          } else {
            console.log(formatCategoryList(categories));
          }
        },
      )
      .command(
        'create <name>',
        'Create a category',
        (yy) =>
          yy
            .positional('name', { type: 'string', demandOption: true })
            .option('color', { type: 'string', default: '#888888', describe: 'Hex color (e.g., #ff0000)' }),
        async (argv) => {
          const server = discoverServer();
          const category = await apiRequest<Category>(server, 'categories/create', [
            { name: argv.name, color: argv.color },
          ]);
          if (argv.json) {
            console.log(JSON.stringify(category, null, 2));
          } else {
            console.log(`Created category ${category.id} — "${category.name}"`);
          }
        },
      )
      .command(
        'update <id>',
        'Update a category',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true })
            .option('name', { type: 'string' })
            .option('color', { type: 'string' }),
        async (argv) => {
          const server = discoverServer();
          const updates: Record<string, unknown> = {};
          if (argv.name) updates.name = argv.name;
          if (argv.color) updates.color = argv.color;

          const category = await apiRequest<Category>(server, 'categories/update', [argv.id, updates]);
          if (argv.json) {
            console.log(JSON.stringify(category, null, 2));
          } else {
            console.log(`Updated category ${category.id}`);
          }
        },
      )
      .command(
        'delete <id>',
        'Delete a category',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          await apiRequest(server, 'categories/delete', [argv.id]);
          console.log(`Deleted category ${argv.id}`);
        },
      )
      .command(
        'assign <task-id> <category-ids..>',
        'Assign categories to a task',
        (yy) =>
          yy
            .positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' })
            .positional('category-ids', { type: 'string', array: true, demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          const catIds = argv['category-ids'] as string[];
          await apiRequest(server, 'categories/assignToTask', [argv['task-id'], catIds]);
          console.log(`Assigned ${catIds.length} category/categories to task ${argv['task-id']}`);
        },
      )
      .demandCommand(1, 'Specify a category subcommand')
  );
}
