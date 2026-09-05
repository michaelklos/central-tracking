import { describe, it, expect } from 'vitest';
import { runCli } from './harness';
import { registerJournalCommands } from '../../commands/journal';

const BODY = ['# Vendor sync', '', '- Chase the SLA numbers', '- Draft the summary'].join('\n');

const sampleJournal = {
  id: '1c4b246e-47fb-4f5b-b60e-d14f6dc08836',
  title: 'Vendor sync',
  body: BODY,
  deletedAt: null,
  createdAt: '2026-09-04T10:00:00.000Z',
  updatedAt: '2026-09-04T10:00:00.000Z',
};

const sampleTask = { id: 'abcd1234-0000-0000-0000-000000000000', title: 'Chase the SLA numbers' };

describe('ct journal list', () => {
  it('renders an empty message when there is nothing', async () => {
    const { stdout } = await runCli(registerJournalCommands, ['journal', 'list'], {
      responses: { 'journals/getAll': [] },
    });
    expect(stdout).toContain('No journal entries');
  });

  it('shows the id prefix, date and title', async () => {
    const { stdout } = await runCli(registerJournalCommands, ['journal', 'list'], {
      responses: { 'journals/getAll': [{ ...sampleJournal, matches: [] }] },
    });
    expect(stdout).toContain('1c4b246e');
    expect(stdout).toContain('2026-09-04');
    expect(stdout).toContain('Vendor sync');
  });

  it('prints the matching lines for a search, not just the title', async () => {
    const { stdout, calls } = await runCli(
      registerJournalCommands,
      ['journal', 'list', '--search', 'SLA'],
      {
        responses: {
          'journals/getAll': [
            { ...sampleJournal, matches: [{ lineNumber: 3, text: '- Chase the SLA numbers' }] },
          ],
        },
      },
    );
    expect(calls[0].args[0]).toMatchObject({ search: 'SLA' });
    expect(stdout).toContain('3: - Chase the SLA numbers');
  });

  it('falls back to the first body line when there is no title', async () => {
    const { stdout } = await runCli(registerJournalCommands, ['journal', 'list'], {
      responses: { 'journals/getAll': [{ ...sampleJournal, title: '', matches: [] }] },
    });
    expect(stdout).toContain('# Vendor sync');
  });
});

describe('ct journal show', () => {
  it('numbers the lines so --line has something to address', async () => {
    const { stdout } = await runCli(registerJournalCommands, ['journal', 'show', '1c4b246e'], {
      responses: { 'journals/getById': sampleJournal },
    });
    expect(stdout).toContain('1  # Vendor sync');
    expect(stdout).toContain('3  - Chase the SLA numbers');
  });

  it('fails when the entry does not resolve', async () => {
    const { stderr, exitCode } = await runCli(registerJournalCommands, ['journal', 'show', 'nope'], {
      responses: { 'journals/getById': null },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('No journal entry');
  });
});

describe('ct journal new', () => {
  it('creates from a title and --body', async () => {
    const { calls, stdout } = await runCli(
      registerJournalCommands,
      ['journal', 'new', 'Vendor sync', '--body', 'notes here'],
      { responses: { 'journals/create': sampleJournal } },
    );
    expect(calls[0]).toEqual({
      endpoint: 'journals/create',
      args: [{ title: 'Vendor sync', body: 'notes here' }],
    });
    expect(stdout).toContain('Created journal entry 1c4b246e');
  });

  it('defaults both fields to empty strings', async () => {
    const { calls } = await runCli(registerJournalCommands, ['journal', 'new'], {
      responses: { 'journals/create': sampleJournal },
    });
    expect(calls[0].args).toEqual([{ title: '', body: '' }]);
  });
});

describe('ct journal edit', () => {
  it('sends only the fields given', async () => {
    const { calls } = await runCli(
      registerJournalCommands,
      ['journal', 'edit', '1c4b246e', '--title', 'Renamed'],
      { responses: { 'journals/update': sampleJournal } },
    );
    expect(calls[0].args).toEqual(['1c4b246e', { title: 'Renamed' }]);
  });

  it('appends to the existing body rather than replacing it', async () => {
    const { calls } = await runCli(
      registerJournalCommands,
      ['journal', 'edit', '1c4b246e', '--append=- One more thing'],
      { responses: { 'journals/getById': sampleJournal, 'journals/update': sampleJournal } },
    );
    expect(calls[1].args[1]).toEqual({ body: `${BODY}\n- One more thing` });
  });

  // Markdown starts with "- " constantly, and yargs reads a space-separated
  // value beginning with a dash as the next flag. `nargs` turns that from a
  // silent empty string into an error naming the option.
  it('fails loudly when a dash-leading value is passed with a space', async () => {
    const { stderr, exitCode } = await runCli(
      registerJournalCommands,
      ['journal', 'edit', '1c4b246e', '--append', '- One more thing'],
      { responses: {} },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('append');
  });

  it('refuses --append together with --body', async () => {
    const { stderr, exitCode } = await runCli(
      registerJournalCommands,
      ['journal', 'edit', '1c4b246e', '--append', 'x', '--body', 'y'],
      { responses: { 'journals/getById': sampleJournal } },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('not both');
  });

  it('refuses a no-op edit rather than sending an empty update', async () => {
    const { stderr, exitCode } = await runCli(
      registerJournalCommands,
      ['journal', 'edit', '1c4b246e'],
      { responses: {} },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Nothing to change');
  });
});

describe('ct journal todo', () => {
  // Offsets are hostile to type on a command line, so the CLI addresses lines
  // and resolves them against the body it just fetched.
  it('turns --line into the offsets the server wants', async () => {
    const { calls, stdout } = await runCli(
      registerJournalCommands,
      ['journal', 'todo', '1c4b246e', '--line', '3'],
      {
        responses: {
          'journals/getById': sampleJournal,
          'journals/createTaskFromSelection': { journal: sampleJournal, task: sampleTask },
        },
      },
    );

    const start = BODY.indexOf('- Chase the SLA numbers');
    expect(calls[1].args[0]).toMatchObject({
      journalId: sampleJournal.id,
      selectionStart: start,
      selectionEnd: start + '- Chase the SLA numbers'.length,
    });
    expect(stdout).toContain('Created task abcd1234');
  });

  it('passes the title and status through', async () => {
    const { calls } = await runCli(
      registerJournalCommands,
      ['journal', 'todo', '1c4b246e', '--line', '3', '--title', 'Get SLA numbers', '--status', 'in-progress'],
      {
        responses: {
          'journals/getById': sampleJournal,
          'journals/createTaskFromSelection': { journal: sampleJournal, task: sampleTask },
        },
      },
    );
    expect(calls[1].args[0]).toMatchObject({ title: 'Get SLA numbers', status: 'in-progress' });
  });

  it('rejects a line past the end of the entry', async () => {
    const { stderr, exitCode } = await runCli(
      registerJournalCommands,
      ['journal', 'todo', '1c4b246e', '--line', '99'],
      { responses: { 'journals/getById': sampleJournal } },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('outside the entry (1–4)');
  });

  it('rejects a blank line', async () => {
    const { stderr, exitCode } = await runCli(
      registerJournalCommands,
      ['journal', 'todo', '1c4b246e', '--line', '2'],
      { responses: { 'journals/getById': sampleJournal } },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('blank');
  });

  it('requires --line', async () => {
    const { exitCode } = await runCli(
      registerJournalCommands,
      ['journal', 'todo', '1c4b246e'],
      { responses: {} },
    );
    expect(exitCode).toBe(1);
  });
});

describe('ct journal attach', () => {
  it('sends the line offsets plus the task reference', async () => {
    const { calls, stdout } = await runCli(
      registerJournalCommands,
      ['journal', 'attach', '1c4b246e', '--line', '4', '--task', 'summary'],
      {
        responses: {
          'journals/getById': sampleJournal,
          'journals/appendSelectionToTask': { journal: sampleJournal, task: sampleTask },
        },
      },
    );
    const start = BODY.indexOf('- Draft the summary');
    expect(calls[1].args[0]).toMatchObject({
      journalId: sampleJournal.id,
      taskId: 'summary',
      selectionStart: start,
      selectionEnd: start + '- Draft the summary'.length,
    });
    expect(stdout).toContain('Appended to task abcd1234');
  });
});

describe('ct journal delete / restore / for-task', () => {
  it('deletes by reference', async () => {
    const { calls, stdout } = await runCli(
      registerJournalCommands,
      ['journal', 'delete', '1c4b246e'],
      { responses: { 'journals/delete': undefined } },
    );
    expect(calls).toEqual([{ endpoint: 'journals/delete', args: ['1c4b246e'] }]);
    expect(stdout).toContain('Deleted journal entry');
  });

  it('restores by reference', async () => {
    const { stdout } = await runCli(registerJournalCommands, ['journal', 'restore', '1c4b246e'], {
      responses: { 'journals/restore': sampleJournal },
    });
    expect(stdout).toContain('Restored journal entry 1c4b246e');
  });

  it('lists the entries behind a task', async () => {
    const { calls, stdout } = await runCli(
      registerJournalCommands,
      ['journal', 'for-task', 'Chase'],
      { responses: { 'journals/getByTask': [{ ...sampleJournal, matches: [] }] } },
    );
    expect(calls).toEqual([{ endpoint: 'journals/getByTask', args: ['Chase'] }]);
    expect(stdout).toContain('Vendor sync');
  });
});

describe('--json', () => {
  it('emits the raw payload for scripting', async () => {
    const { stdout } = await runCli(registerJournalCommands, ['journal', 'list', '--json'], {
      responses: { 'journals/getAll': [{ ...sampleJournal, matches: [] }] },
    });
    expect(JSON.parse(stdout)).toEqual([{ ...sampleJournal, matches: [] }]);
  });
});
