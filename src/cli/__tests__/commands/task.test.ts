import { describe, it, expect } from 'vitest';
import { runCli } from './harness';
import { registerTaskCommands } from '../../commands/task';

const sampleTask = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Hello',
  description: '',
  notes: '',
  status: 'todo',
  source: 'ad-hoc',
  categoryIds: [],
  createdAt: '2026-04-17T10:00:00.000Z',
  updatedAt: '2026-04-17T10:00:00.000Z',
  totalTimeSeconds: 0,
  todayTimeSeconds: 0,
  pluginId: null,
  externalId: null,
  sortOrder: 0,
  deletedAt: null,
};

describe('ct task list', () => {
  it('calls tasks/getActive and formats a table', async () => {
    const result = await runCli(registerTaskCommands, ['task', 'list'], {
      responses: {
        'tasks/getActive': { items: [sampleTask], total: 1, hasMore: false, offset: 0, limit: 50 },
      },
    });
    expect(result.exitCode).toBeNull();
    expect(result.calls).toEqual([
      { endpoint: 'tasks/getActive', args: [{ offset: 0, limit: 50, sortBy: undefined }] },
    ]);
    expect(result.stdout).toContain('Hello');
    expect(result.stdout).toContain('todo');
  });

  it('routes --done to tasks/getDone', async () => {
    const { calls } = await runCli(registerTaskCommands, ['task', 'list', '--done'], {
      responses: {
        'tasks/getDone': { items: [], total: 0, hasMore: false, offset: 0, limit: 50 },
      },
    });
    expect(calls[0].endpoint).toBe('tasks/getDone');
  });

  it('routes --deleted to tasks/getDeleted with pagination only', async () => {
    const { calls } = await runCli(registerTaskCommands, ['task', 'list', '--deleted'], {
      responses: {
        'tasks/getDeleted': { items: [], total: 0, hasMore: false, offset: 0, limit: 50 },
      },
    });
    expect(calls[0]).toEqual({ endpoint: 'tasks/getDeleted', args: [{ offset: 0, limit: 50 }] });
  });

  it('routes --all to tasks/getAll (flat list)', async () => {
    const { calls } = await runCli(registerTaskCommands, ['task', 'list', '--all'], {
      responses: { 'tasks/getAll': [sampleTask] },
    });
    expect(calls).toEqual([{ endpoint: 'tasks/getAll', args: [] }]);
  });

  it('passes --search, --status, --category to tasks/getActive', async () => {
    const { calls } = await runCli(
      registerTaskCommands,
      ['task', 'list', '--search', 'foo', '--status', 'in-progress', '--category', 'cat-1'],
      {
        responses: {
          'tasks/getActive': { items: [], total: 0, hasMore: false, offset: 0, limit: 50 },
        },
      },
    );
    expect(calls[0].args[0]).toMatchObject({
      search: 'foo',
      status: 'in-progress',
      categoryId: 'cat-1',
    });
  });

  it('emits JSON when --json is set', async () => {
    const result = await runCli(registerTaskCommands, ['task', 'list', '--json'], {
      responses: {
        'tasks/getActive': { items: [sampleTask], total: 1, hasMore: false, offset: 0, limit: 50 },
      },
    });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.items[0].id).toBe(sampleTask.id);
  });
});

describe('ct task get', () => {
  it('prints task details', async () => {
    const result = await runCli(registerTaskCommands, ['task', 'get', sampleTask.id], {
      responses: { 'tasks/getById': sampleTask },
    });
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain(`ID:          ${sampleTask.id}`);
    expect(result.stdout).toContain('Title:       Hello');
  });

  it('exits 1 when task is not found', async () => {
    const result = await runCli(registerTaskCommands, ['task', 'get', 'missing'], {
      responses: { 'tasks/getById': null },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Task missing not found');
  });
});

describe('ct task create', () => {
  it('builds minimal create input', async () => {
    const { calls } = await runCli(registerTaskCommands, ['task', 'create', 'My task'], {
      responses: { 'tasks/create': sampleTask },
    });
    expect(calls[0]).toEqual({ endpoint: 'tasks/create', args: [{ title: 'My task' }] });
  });

  it('passes --description, --status, --source, --category', async () => {
    const { calls } = await runCli(
      registerTaskCommands,
      [
        'task',
        'create',
        'With opts',
        '--description',
        'desc',
        '--status',
        'in-progress',
        '--source',
        'ad-hoc',
        '--category',
        'c1',
        '--category',
        'c2',
      ],
      { responses: { 'tasks/create': sampleTask } },
    );
    expect(calls[0].args[0]).toEqual({
      title: 'With opts',
      description: 'desc',
      status: 'in-progress',
      source: 'ad-hoc',
      categoryIds: ['c1', 'c2'],
    });
  });

  it('rejects invalid status choice', async () => {
    const result = await runCli(registerTaskCommands, ['task', 'create', 't', '--status', 'bogus'], {
      responses: { 'tasks/create': sampleTask },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid values');
  });
});

describe('ct task delete', () => {
  it('single delete uses tasks/delete', async () => {
    const { calls } = await runCli(registerTaskCommands, ['task', 'delete', 'id-1'], {
      responses: { 'tasks/delete': undefined },
    });
    expect(calls).toEqual([{ endpoint: 'tasks/delete', args: ['id-1'] }]);
  });

  it('multi delete uses batchSoftDelete', async () => {
    const { calls, stdout } = await runCli(
      registerTaskCommands,
      ['task', 'delete', 'id-1', 'id-2'],
      { responses: { 'tasks/batchSoftDelete': { deletedCount: 2 } } },
    );
    expect(calls).toEqual([{ endpoint: 'tasks/batchSoftDelete', args: [['id-1', 'id-2']] }]);
    expect(stdout).toContain('Deleted 2 tasks');
  });
});

describe('ct task purge', () => {
  it('requires --all or --id', async () => {
    const result = await runCli(registerTaskCommands, ['task', 'purge'], { responses: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Specify --id');
  });

  it('--all calls emptyRecycleBin', async () => {
    const { calls } = await runCli(registerTaskCommands, ['task', 'purge', '--all'], {
      responses: { 'tasks/emptyRecycleBin': undefined },
    });
    expect(calls).toEqual([{ endpoint: 'tasks/emptyRecycleBin', args: [] }]);
  });

  it('--id calls purgeDeleted', async () => {
    const { calls } = await runCli(registerTaskCommands, ['task', 'purge', '--id', 'xyz'], {
      responses: { 'tasks/purgeDeleted': undefined },
    });
    expect(calls).toEqual([{ endpoint: 'tasks/purgeDeleted', args: ['xyz'] }]);
  });
});

describe('ct task — server down', () => {
  it('exits 1 with a clean message', async () => {
    const result = await runCli(registerTaskCommands, ['task', 'list'], { serverDown: true });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Central Tracking is not running');
  });
});
