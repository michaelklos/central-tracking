import type { Argv } from 'yargs';
import { formatCommentList } from '../formatters';
import { runCommand, output, say } from '../runtime';

export function registerCommentCommands(yargs: Argv): Argv {
  return yargs.command('comment', 'Manage comments', (y) =>
    y
      .command(
        'list <task-id>',
        'List comments for a task',
        (yy) => yy.positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const comments = await client.comments.getByTask(argv['task-id'] as string);
            output(argv, comments, formatCommentList);
          }),
      )
      .command(
        'add <task-id> <body>',
        'Add a comment to a task',
        (yy) =>
          yy
            .positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' })
            .positional('body', { type: 'string', demandOption: true })
            .option('syncable', { type: 'boolean', default: false }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const comment = await client.comments.create({
              taskId: argv['task-id'] as string,
              body: argv.body as string,
              syncable: argv.syncable as boolean,
            });
            output(argv, comment, (c) => `Added comment ${c.id}`);
          }),
      )
      .command(
        'update <id>',
        'Update a comment',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true })
            .option('body', { type: 'string' })
            .option('syncable', { type: 'boolean' })
            .option('synced', { type: 'boolean', describe: 'Mark as synced to the external system' }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const updates: { body?: string; syncable?: boolean; synced?: boolean } = {};
            if (argv.body !== undefined) updates.body = argv.body;
            if (argv.syncable !== undefined) updates.syncable = argv.syncable;
            if (argv.synced !== undefined) updates.synced = argv.synced;

            const comment = await client.comments.update(argv.id as string, updates);
            output(argv, comment, (c) => `Updated comment ${c.id}`);
          }),
      )
      .command(
        'delete <id>',
        'Delete a comment',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            await client.comments.delete(argv.id as string);
            say(`Deleted comment ${argv.id}`);
          }),
      )
      .demandCommand(1, 'Specify a comment subcommand')
  );
}
