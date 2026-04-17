import type { Argv } from 'yargs';
import { discoverServer, apiRequest } from '../client';
import { formatCommentList } from '../formatters';
import type { Comment } from '../../shared/types';

export function registerCommentCommands(yargs: Argv): Argv {
  return yargs.command('comment', 'Manage comments', (y) =>
    y
      .command(
        'list <task-id>',
        'List comments for a task',
        (yy) => yy.positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' }),
        async (argv) => {
          const server = discoverServer();
          const comments = await apiRequest<Comment[]>(server, 'comments/getByTask', [argv['task-id']]);
          if (argv.json) {
            console.log(JSON.stringify(comments, null, 2));
          } else {
            console.log(formatCommentList(comments));
          }
        },
      )
      .command(
        'add <task-id> <body>',
        'Add a comment to a task',
        (yy) =>
          yy
            .positional('task-id', { type: 'string', demandOption: true, describe: 'UUID, prefix, or name substring' })
            .positional('body', { type: 'string', demandOption: true })
            .option('syncable', { type: 'boolean', default: false }),
        async (argv) => {
          const server = discoverServer();
          const comment = await apiRequest<Comment>(server, 'comments/create', [
            { taskId: argv['task-id'], body: argv.body, syncable: argv.syncable },
          ]);
          if (argv.json) {
            console.log(JSON.stringify(comment, null, 2));
          } else {
            console.log(`Added comment ${comment.id}`);
          }
        },
      )
      .command(
        'delete <id>',
        'Delete a comment',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          await apiRequest(server, 'comments/delete', [argv.id]);
          console.log(`Deleted comment ${argv.id}`);
        },
      )
      .demandCommand(1, 'Specify a comment subcommand')
  );
}
