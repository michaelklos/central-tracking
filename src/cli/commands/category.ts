import type { Argv } from 'yargs';
import { formatCategoryList } from '../formatters';
import { runCommand, output, say } from '../runtime';
import type { UpdateCategoryInput } from '../../shared/types';

export function registerCategoryCommands(yargs: Argv): Argv {
  return yargs.command('category', 'Manage categories', (y) =>
    y
      .command(
        'list',
        'List all categories',
        () => {},
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const categories = await client.categories.getAll();
            output(argv, categories, formatCategoryList);
          }),
      )
      .command(
        'create <name>',
        'Create a category',
        (yy) =>
          yy
            .positional('name', { type: 'string', demandOption: true })
            .option('color', { type: 'string', default: '#888888', describe: 'Hex color (e.g., #ff0000)' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const category = await client.categories.create({
              name: argv.name as string,
              color: argv.color as string,
            });
            output(argv, category, (c) => `Created category ${c.id} — "${c.name}"`);
          }),
      )
      .command(
        'update <id>',
        'Update a category',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true })
            .option('name', { type: 'string' })
            .option('color', { type: 'string' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const updates: UpdateCategoryInput = {};
            if (argv.name) updates.name = argv.name;
            if (argv.color) updates.color = argv.color;

            const category = await client.categories.update(argv.id as string, updates);
            output(argv, category, (c) => `Updated category ${c.id}`);
          }),
      )
      .command(
        'delete <id>',
        'Delete a category',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            await client.categories.delete(argv.id as string);
            say(`Deleted category ${argv.id}`);
          }),
      )
      .command(
        'assign <task-id> <category-ids..>',
        'Assign categories to a task',
        (yy) =>
          yy
            .positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' })
            .positional('category-ids', { type: 'string', array: true, demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const catIds = argv['category-ids'] as string[];
            await client.categories.assignToTask(argv['task-id'] as string, catIds);
            say(`Assigned ${catIds.length} category/categories to task ${argv['task-id']}`);
          }),
      )
      .demandCommand(1, 'Specify a category subcommand')
  );
}
