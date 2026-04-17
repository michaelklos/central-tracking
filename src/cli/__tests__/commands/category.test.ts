import { describe, it, expect } from 'vitest';
import { runCli } from './harness';
import { registerCategoryCommands } from '../../commands/category';

const sampleCategory = {
  id: 'cat-1',
  name: 'Work',
  color: '#ff0000',
  createdAt: '2026-04-17T10:00:00.000Z',
};

describe('ct category list', () => {
  it('prints "No categories." when empty', async () => {
    const { stdout } = await runCli(registerCategoryCommands, ['category', 'list'], {
      responses: { 'categories/getAll': [] },
    });
    expect(stdout).toContain('No categories');
  });

  it('renders name + color', async () => {
    const { stdout } = await runCli(registerCategoryCommands, ['category', 'list'], {
      responses: { 'categories/getAll': [sampleCategory] },
    });
    expect(stdout).toContain('Work');
    expect(stdout).toContain('#ff0000');
  });
});

describe('ct category create', () => {
  it('uses default color when --color omitted', async () => {
    const { calls } = await runCli(
      registerCategoryCommands,
      ['category', 'create', 'Work'],
      { responses: { 'categories/create': sampleCategory } },
    );
    expect(calls).toEqual([
      { endpoint: 'categories/create', args: [{ name: 'Work', color: '#888888' }] },
    ]);
  });

  it('passes explicit --color', async () => {
    const { calls } = await runCli(
      registerCategoryCommands,
      ['category', 'create', 'Work', '--color', '#00ff00'],
      { responses: { 'categories/create': sampleCategory } },
    );
    expect((calls[0].args[0] as { color: string }).color).toBe('#00ff00');
  });
});

describe('ct category update', () => {
  it('only sends provided fields', async () => {
    const { calls } = await runCli(
      registerCategoryCommands,
      ['category', 'update', 'cat-1', '--name', 'Renamed'],
      { responses: { 'categories/update': sampleCategory } },
    );
    expect(calls).toEqual([{ endpoint: 'categories/update', args: ['cat-1', { name: 'Renamed' }] }]);
  });
});

describe('ct category delete', () => {
  it('calls categories/delete', async () => {
    const { calls } = await runCli(
      registerCategoryCommands,
      ['category', 'delete', 'cat-1'],
      { responses: { 'categories/delete': undefined } },
    );
    expect(calls).toEqual([{ endpoint: 'categories/delete', args: ['cat-1'] }]);
  });
});

describe('ct category assign', () => {
  it('posts taskId + category list', async () => {
    const { calls, stdout } = await runCli(
      registerCategoryCommands,
      ['category', 'assign', 'task-1', 'cat-1', 'cat-2'],
      { responses: { 'categories/assignToTask': undefined } },
    );
    expect(calls).toEqual([
      { endpoint: 'categories/assignToTask', args: ['task-1', ['cat-1', 'cat-2']] },
    ]);
    expect(stdout).toContain('Assigned 2 category');
  });
});
