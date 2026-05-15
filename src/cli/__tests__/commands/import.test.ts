import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from './harness';
import { registerImportCommands } from '../../commands/import';

let tmpDir: string;
let inputFile: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-import-test-'));
  inputFile = path.join(tmpDir, 'input.md');
  fs.writeFileSync(inputFile, '- [ ] Example task\n', 'utf-8');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ct import preview', () => {
  it('shows counts + items', async () => {
    const items = [{ title: 'Example task', action: 'create', existingTask: null }];
    const { stdout, calls } = await runCli(
      registerImportCommands,
      ['import', 'preview', inputFile],
      { responses: { 'import/parseContent': { items, errors: [] } } },
    );
    expect(calls[0].endpoint).toBe('import/parseContent');
    expect(stdout).toContain('1 new');
    expect(stdout).toContain('[NEW] Example task');
  });

  it('prints parse errors', async () => {
    const { stdout } = await runCli(
      registerImportCommands,
      ['import', 'preview', inputFile],
      {
        responses: {
          'import/parseContent': {
            items: [],
            errors: [{ line: 'garbage', lineNumber: 1, reason: 'unparseable' }],
          },
        },
      },
    );
    expect(stdout).toContain('Parse errors');
    expect(stdout).toContain('unparseable');
  });
});

describe('ct import execute', () => {
  it('dry-run summarizes without calling execute', async () => {
    const items = [{ title: 'Example', action: 'create', existingTask: null }];
    const { stdout, calls } = await runCli(
      registerImportCommands,
      ['import', 'execute', inputFile, '--dry-run'],
      { responses: { 'import/parseContent': { items, errors: [] } } },
    );
    expect(calls.map((c) => c.endpoint)).toEqual(['import/parseContent']);
    expect(stdout).toContain('Dry run');
  });

  it('--update-existing rewrites existing items to action:update', async () => {
    const items = [
      { title: 'Example', action: 'skip', existingTask: { id: 'x', title: 'Example' } },
    ];
    const { calls } = await runCli(
      registerImportCommands,
      ['import', 'execute', inputFile, '--update-existing'],
      {
        responses: {
          'import/parseContent': { items, errors: [] },
          'import/execute': { created: 0, updated: 0, skipped: 0, errors: [] },
        },
      },
    );
    const executeCall = calls.find((c) => c.endpoint === 'import/execute');
    expect(executeCall).toBeDefined();
    const sent = executeCall!.args[0] as Array<{ action: string }>;
    expect(sent[0].action).toBe('update');
  });

  it('reports created/skipped counts', async () => {
    const items = [{ title: 'Example', action: 'create', existingTask: null }];
    const { stdout } = await runCli(
      registerImportCommands,
      ['import', 'execute', inputFile],
      {
        responses: {
          'import/parseContent': { items, errors: [] },
          'import/execute': { created: 1, updated: 0, skipped: 0, errors: [] },
        },
      },
    );
    expect(stdout).toContain('Import complete: 1 created, 0 appended, 0 skipped');
  });
});
