import * as fs from 'fs';
import type { Argv } from 'yargs';
import { discoverServer, apiRequest } from '../client';

interface ImportPreviewItem {
  title: string;
  source: string;
  externalId: string;
  pluginId: string;
  startDateTime: string;
  endDateTime: string;
  durationSeconds: number;
  existingTask: { id: string; title: string } | null;
  action: 'create' | 'skip' | 'update';
}

interface ImportParseResult {
  items: ImportPreviewItem[];
  errors: string[];
}

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

function readInput(filePath: string): string {
  if (filePath === '-') {
    return fs.readFileSync(0, 'utf-8'); // stdin
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export function registerImportCommands(yargs: Argv): Argv {
  return yargs.command('import', 'Import tasks from file', (y) =>
    y
      .command(
        'preview <file>',
        'Parse import file and show preview',
        (yy) => yy.positional('file', { type: 'string', demandOption: true }),
        async (argv) => {
          const server = discoverServer();
          const content = readInput(argv.file);
          const result = await apiRequest<ImportParseResult>(server, 'import/parseContent', [content]);

          if (argv.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          if (result.errors.length > 0) {
            console.error('Parse errors:');
            for (const err of result.errors) {
              console.error(`  - ${err}`);
            }
            console.error('');
          }

          if (result.items.length === 0) {
            console.log('No items found in import file.');
            return;
          }

          const toCreate = result.items.filter((i) => i.action === 'create');
          const toSkip = result.items.filter((i) => i.action === 'skip');

          console.log(`Found ${result.items.length} items: ${toCreate.length} new, ${toSkip.length} existing\n`);

          for (const item of result.items) {
            const status = item.action === 'create' ? '[NEW]' : '[SKIP]';
            const existing = item.existingTask ? ` (matches: ${item.existingTask.title})` : '';
            console.log(`  ${status} ${item.title}${existing}`);
          }
        },
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
        async (argv) => {
          const server = discoverServer();
          const content = readInput(argv.file);
          const parsed = await apiRequest<ImportParseResult>(server, 'import/parseContent', [content]);

          if (parsed.errors.length > 0) {
            console.error('Parse errors:');
            for (const err of parsed.errors) {
              console.error(`  - ${err}`);
            }
            if (parsed.items.length === 0) {
              process.exit(1);
            }
            console.error('');
          }

          // Apply conflict resolution strategy
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
            console.log(`Dry run: ${toCreate.length} create, ${toUpdate.length} update, ${toSkip.length} skip`);
            if (argv.json) {
              console.log(JSON.stringify(items, null, 2));
            }
            return;
          }

          const result = await apiRequest<ImportResult>(server, 'import/execute', [items]);

          if (argv.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`Import complete: ${result.created} created, ${result.skipped} skipped`);
            if (result.errors.length > 0) {
              console.error('Errors:');
              for (const err of result.errors) {
                console.error(`  - ${err}`);
              }
            }
          }
        },
      )
      .demandCommand(1, 'Specify an import subcommand')
  );
}
