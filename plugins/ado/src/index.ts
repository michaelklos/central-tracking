#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

function notImplemented(name: string): void {
  // Plain stdout so `ct plugin run ado <cmd>` shows it inline.
  // Stage 1+ will replace with real implementations.
  process.stdout.write(`[ado] ${name}: not implemented\n`);
}

void yargs(hideBin(process.argv))
  .scriptName('ado')
  .command('pull', 'Pull current sprint work items from ADO into ct', {}, () => notImplemented('pull'))
  .command('push', 'Push pending state, comments, and time to ADO', {}, () => notImplemented('push'))
  .command('sync', 'push → pull in a single run', {}, () => notImplemented('sync'))
  .command(
    'refresh <taskId>',
    'Refresh a single ado-source task from the work item',
    (y) => y.positional('taskId', { type: 'string', demandOption: true }),
    () => notImplemented('refresh'),
  )
  .demandCommand(1, 'Specify a subcommand: pull | push | sync | refresh')
  .strict()
  .help()
  .parse();
