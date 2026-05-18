#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { AdoClient } from './ado-client';
import { loadConfig } from './config';
import { CtClient } from './ct-client';
import { pull, refresh } from './pull';
import { pushTime } from './push-time';

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[ado] error: ${msg}\n`);
  process.exit(1);
}

interface Clients {
  ct: CtClient;
  ado: AdoClient;
  config: Awaited<ReturnType<typeof loadConfig>>;
}

async function bootstrap(): Promise<Clients> {
  const ct = new CtClient();
  const config = await loadConfig(ct);
  const ado = new AdoClient({
    organization: config.organization,
    project: config.project,
    pat: config.pat,
  });
  return { ct, ado, config };
}

async function runPull(): Promise<void> {
  const { ct, ado, config } = await bootstrap();
  const result = await pull(ado, ct, config);
  for (const w of result.warnings) process.stdout.write(`${w}\n`);
  process.stdout.write(
    `[ado] pull: ${result.tasksUpserted} task(s), ${result.commentsMirrored} comment(s) mirrored\n`,
  );
}

async function runRefresh(taskId: string): Promise<void> {
  const { ct, ado, config } = await bootstrap();
  const result = await refresh(ado, ct, config, taskId);
  for (const w of result.warnings) process.stdout.write(`${w}\n`);
  process.stdout.write(
    `[ado] refresh: task ${result.task.id} (#${result.task.externalId}), ${result.commentsMirrored} comment(s) mirrored\n`,
  );
}

async function runPushTime(clients?: Clients): Promise<void> {
  const { ct, ado, config } = clients ?? (await bootstrap());
  const result = await pushTime(ado, ct, config);
  for (const w of result.warnings) process.stdout.write(`${w}\n`);
  process.stdout.write(
    `[ado] push-time: ${result.tasksPushed} pushed (${result.hoursPushed}h), ` +
      `${result.tasksSkippedZero} skipped, ${result.tasksFailed} failed ` +
      `(of ${result.tasksConsidered} considered)\n`,
  );
}

async function runSync(): Promise<void> {
  const clients = await bootstrap();
  // Push first so a fresh push doesn't get clobbered by stale pull data in same run.
  // Stage 2: only time push (state/comment push land in Stage 3).
  await runPushTime(clients);
  const pullResult = await pull(clients.ado, clients.ct, clients.config);
  for (const w of pullResult.warnings) process.stdout.write(`${w}\n`);
  process.stdout.write(
    `[ado] pull: ${pullResult.tasksUpserted} task(s), ${pullResult.commentsMirrored} comment(s) mirrored\n`,
  );
}

void yargs(hideBin(process.argv))
  .scriptName('ado')
  .command('pull', 'Pull current sprint work items from ADO into ct', {}, () => {
    runPull().catch(fail);
  })
  .command('push', 'Push pending time to ADO', {}, () => {
    runPushTime().catch(fail);
  })
  .command('sync', 'push → pull in a single run', {}, () => {
    runSync().catch(fail);
  })
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
