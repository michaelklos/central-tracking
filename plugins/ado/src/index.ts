#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { AdoClient } from './ado-client';
import { loadConfig } from './config';
import { CtClient } from './ct-client';
import { pull, refresh } from './pull';
import { pushComments } from './push-comments';
import { pushState } from './push-state';
import { pushTime } from './push-time';
import { sync } from './sync';

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

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function runPull(): Promise<void> {
  const { ct, ado, config } = await bootstrap();
  const result = await pull(ado, ct, config);
  for (const w of result.warnings) write(w);
  write(`[ado] pull: ${result.tasksUpserted} task(s), ${result.commentsMirrored} comment(s) mirrored`);
}

async function runRefresh(taskId: string): Promise<void> {
  const { ct, ado, config } = await bootstrap();
  const result = await refresh(ado, ct, config, taskId);
  for (const w of result.warnings) write(w);
  write(
    `[ado] refresh: task ${result.task.id} (#${result.task.externalId}), ${result.commentsMirrored} comment(s) mirrored`,
  );
}

async function runPushTime(): Promise<void> {
  const { ct, ado, config } = await bootstrap();
  const result = await pushTime(ado, ct, config);
  for (const w of result.warnings) write(w);
  write(
    `[ado] push-time: ${result.tasksPushed} pushed (${result.hoursPushed}h), ` +
      `${result.tasksSkippedZero} skipped, ${result.tasksFailed} failed ` +
      `(of ${result.tasksConsidered} considered)`,
  );
}

async function runPushState(): Promise<void> {
  const { ct, ado, config } = await bootstrap();
  const result = await pushState(ado, ct, config);
  for (const w of result.warnings) write(w);
  write(
    `[ado] push-state: ${result.pushed} pushed, ${result.skippedBlocked} blocked-skip, ` +
      `${result.rejectedByWorkflow} workflow-reject, ${result.failed} failed ` +
      `(of ${result.considered} considered)`,
  );
}

async function runPushComments(): Promise<void> {
  const { ct, ado } = await bootstrap();
  const result = await pushComments(ado, ct);
  for (const w of result.warnings) write(w);
  write(
    `[ado] push-comments: ${result.pushed} pushed, ${result.failed} failed ` +
      `(of ${result.considered} considered)`,
  );
}

async function runSync(): Promise<void> {
  const { ct, ado, config } = await bootstrap();
  const out = await sync(ado, ct, config);
  for (const w of out.state.warnings) write(w);
  write(
    `[ado] push-state: ${out.state.pushed} pushed, ${out.state.skippedBlocked} blocked-skip, ` +
      `${out.state.rejectedByWorkflow} workflow-reject, ${out.state.failed} failed`,
  );
  for (const w of out.time.warnings) write(w);
  write(
    `[ado] push-time: ${out.time.tasksPushed} pushed (${out.time.hoursPushed}h), ` +
      `${out.time.tasksSkippedZero} skipped, ${out.time.tasksFailed} failed`,
  );
  if (config.autoCommentOnTimePush) {
    for (const w of out.autoComments.warnings) write(w);
    write(
      `[ado] auto-comment: ${out.autoComments.posted} posted, ${out.autoComments.failed} failed`,
    );
  }
  for (const w of out.comments.warnings) write(w);
  write(
    `[ado] push-comments: ${out.comments.pushed} pushed, ${out.comments.failed} failed`,
  );
  for (const w of out.pull.warnings) write(w);
  write(
    `[ado] pull: ${out.pull.tasksUpserted} task(s), ${out.pull.commentsMirrored} comment(s) mirrored`,
  );
}

void yargs(hideBin(process.argv))
  .scriptName('ado')
  .command('pull', 'Pull current sprint work items from ADO into ct', {}, () => {
    runPull().catch(fail);
  })
  .command('push', 'Push pending time to ADO (alias: push-time)', {}, () => {
    runPushTime().catch(fail);
  })
  .command('push-time', 'Push pending time to ADO', {}, () => {
    runPushTime().catch(fail);
  })
  .command('push-state', 'Push dirty status changes to ADO', {}, () => {
    runPushState().catch(fail);
  })
  .command('push-comments', 'Push pending syncable comments to ADO', {}, () => {
    runPushComments().catch(fail);
  })
  .command('sync', 'push-state → push-time → push-comments → pull in one run', {}, () => {
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
  .demandCommand(1, 'Specify a subcommand: pull | push | push-state | push-comments | sync | refresh')
  .strict()
  .help()
  .parse();
