#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { AdoClient } from './ado-client';
import { loadConfig } from './config';
import { CtClient } from './ct-client';
import { pull, refresh } from './pull';

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[ado] error: ${msg}\n`);
  process.exit(1);
}

function notImplemented(name: string): void {
  process.stdout.write(`[ado] ${name}: not implemented\n`);
}

async function runPull(): Promise<void> {
  const ct = new CtClient();
  const config = await loadConfig(ct);
  const ado = new AdoClient({
    organization: config.organization,
    project: config.project,
    pat: config.pat,
  });
  const result = await pull(ado, ct, config);
  for (const w of result.warnings) process.stdout.write(`${w}\n`);
  process.stdout.write(
    `[ado] pull: ${result.tasksUpserted} task(s), ${result.commentsMirrored} comment(s) mirrored\n`,
  );
}

async function runRefresh(taskId: string): Promise<void> {
  const ct = new CtClient();
  const config = await loadConfig(ct);
  const ado = new AdoClient({
    organization: config.organization,
    project: config.project,
    pat: config.pat,
  });
  const result = await refresh(ado, ct, config, taskId);
  for (const w of result.warnings) process.stdout.write(`${w}\n`);
  process.stdout.write(
    `[ado] refresh: task ${result.task.id} (#${result.task.externalId}), ${result.commentsMirrored} comment(s) mirrored\n`,
  );
}

void yargs(hideBin(process.argv))
  .scriptName('ado')
  .command('pull', 'Pull current sprint work items from ADO into ct', {}, () => {
    runPull().catch(fail);
  })
  .command('push', 'Push pending state, comments, and time to ADO', {}, () => notImplemented('push'))
  .command('sync', 'push → pull in a single run', {}, () => notImplemented('sync'))
  .command(
    'refresh <taskId>',
    'Refresh a single ado-source task from the work item',
    (y) => y.positional('taskId', { type: 'string', demandOption: true }),
    (argv) => {
      runRefresh(String(argv.taskId)).catch(fail);
    },
  )
  .demandCommand(1, 'Specify a subcommand: pull | push | sync | refresh')
  .strict()
  .help()
  .parse();
