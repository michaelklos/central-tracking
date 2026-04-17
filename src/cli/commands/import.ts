import * as fs from 'fs';
import type { Argv } from 'yargs';
import { runCommand, output, say, fail } from '../runtime';
import type { ImportPreviewItem as SharedImportPreviewItem, ImportError } from '../../shared/types';

// CLI extends the server's action set with 'update' for --update-existing.
type ImportPreviewItem = Omit<SharedImportPreviewItem, 'action'> & {
  action: 'create' | 'skip' | 'update';
};

interface ImportParseResult {
  items: ImportPreviewItem[];
  errors: ImportError[];
}

function readInput(filePath: string): string {
  if (filePath === '-') {
    return fs.readFileSync(0, 'utf-8'); // stdin
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function formatParseErrors(errors: ImportError[]): string {
  return ['Parse errors:', ...errors.map((e) => `  - ${e.reason} (line ${e.lineNumber}: ${e.line})`)].join('\n');
}

function formatPreview(result: ImportParseResult): string {
  const lines: string[] = [];
  if (result.errors.length > 0) {
    lines.push(formatParseErrors(result.errors), '');
  }
  if (result.items.length === 0) {
    lines.push('No items found in import file.');
    return lines.join('\n');
  }

  const toCreate = result.items.filter((i) => i.action === 'create');
  const toSkip = result.items.filter((i) => i.action === 'skip');

  lines.push(`Found ${result.items.length} items: ${toCreate.length} new, ${toSkip.length} existing`, '');
  for (const item of result.items) {
    const status = item.action === 'create' ? '[NEW]' : '[SKIP]';
    const existing = item.existingTask ? ` (matches: ${item.existingTask.title})` : '';
    lines.push(`  ${status} ${item.title}${existing}`);
  }
  return lines.join('\n');
}

export function registerImportCommands(yargs: Argv): Argv {
  return yargs.command('import', 'Import tasks from file', (y) =>
    y
      .command(
        'preview <file>',
        'Parse import file and show preview',
        (yy) => yy.positional('file', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ request }) => {
            const content = readInput(argv.file as string);
            const result = await request<ImportParseResult>('import/parseContent', [content]);
            output(argv, result, formatPreview);
          }),
      )
      .command(
        'execute <file>',
        'Execute import from file',
        (yy) =>
          yy
            .positional('file', { type: 'string', demandOption: true })
            .option('skip-existing', { type: 'boolean', default: true, describe: 'Skip items that match existing tasks' })
            .option('update-existing', { type: 'boolean', default: false, describe: 'Update existing tasks instead of skipping' })
            .option('dry-run', { type: 'boolean', default: false, describe: 'Preview without executing' }),
        (argv) =>
          runCommand(argv, async ({ request }) => {
            const content = readInput(argv.file as string);
            const parsed = await request<ImportParseResult>('import/parseContent', [content]);

            if (parsed.errors.length > 0) {
              process.stderr.write(`${formatParseErrors(parsed.errors)}\n`);
              if (parsed.items.length === 0) fail('No items to import.');
            }

            const items = parsed.items.map((item) => {
              if (item.existingTask && argv['update-existing']) {
                return { ...item, action: 'update' as const };
              }
              if (item.existingTask && argv['skip-existing']) {
                return { ...item, action: 'skip' as const };
              }
              return item;
            });

            if (argv['dry-run']) {
              const toCreate = items.filter((i) => i.action === 'create');
              const toSkip = items.filter((i) => i.action === 'skip');
              const toUpdate = items.filter((i) => i.action === 'update');
              if (argv.json) {
                output(argv, items, () => '');
              } else {
                say(`Dry run: ${toCreate.length} create, ${toUpdate.length} update, ${toSkip.length} skip`);
              }
              return;
            }

            const result = await request<{ created: number; skipped: number; errors: string[] }>('import/execute', [items]);

            output(argv, result, (r) => {
              const lines = [`Import complete: ${r.created} created, ${r.skipped} skipped`];
              if (r.errors.length > 0) {
                lines.push('Errors:', ...r.errors.map((e) => `  - ${e}`));
              }
              return lines.join('\n');
            });
          }),
      )
      .demandCommand(1, 'Specify an import subcommand')
  );
}
