import { describe, it, expect } from 'vitest';
import { runCli } from './harness';
import { registerCommentCommands } from '../../commands/comment';

const sampleComment = {
  id: 'c-1',
  taskId: 'task-1',
  body: 'hello',
  syncable: false,
  synced: false,
  createdAt: '2026-04-17T10:00:00.000Z',
};

describe('ct comment list', () => {
  it('renders "No comments." when empty', async () => {
    const { stdout } = await runCli(registerCommentCommands, ['comment', 'list', 'task-1'], {
      responses: { 'comments/getByTask': [] },
    });
    expect(stdout).toContain('No comments');
  });

  it('shows each comment body + id prefix', async () => {
    const { stdout, calls } = await runCli(
      registerCommentCommands,
      ['comment', 'list', 'task-1'],
      { responses: { 'comments/getByTask': [sampleComment] } },
    );
    expect(calls).toEqual([{ endpoint: 'comments/getByTask', args: ['task-1'] }]);
    expect(stdout).toContain('hello');
    expect(stdout).toContain(sampleComment.id.slice(0, 8));
  });
});

describe('ct comment add', () => {
  it('creates comment with default syncable=false', async () => {
    const { calls } = await runCli(
      registerCommentCommands,
      ['comment', 'add', 'task-1', 'body-text'],
      { responses: { 'comments/create': sampleComment } },
    );
    expect(calls).toEqual([
      { endpoint: 'comments/create', args: [{ taskId: 'task-1', body: 'body-text', syncable: false }] },
    ]);
  });

  it('honors --syncable', async () => {
    const { calls } = await runCli(
      registerCommentCommands,
      ['comment', 'add', 'task-1', 'body', '--syncable'],
      { responses: { 'comments/create': sampleComment } },
    );
    expect((calls[0].args[0] as { syncable: boolean }).syncable).toBe(true);
  });
});

describe('ct comment update', () => {
  it('only sends specified fields', async () => {
    const { calls } = await runCli(
      registerCommentCommands,
      ['comment', 'update', 'c-1', '--synced'],
      { responses: { 'comments/update': sampleComment } },
    );
    expect(calls).toEqual([{ endpoint: 'comments/update', args: ['c-1', { synced: true }] }]);
  });
});

describe('ct comment delete', () => {
  it('calls comments/delete', async () => {
    const { calls, stdout } = await runCli(
      registerCommentCommands,
      ['comment', 'delete', 'c-1'],
      { responses: { 'comments/delete': undefined } },
    );
    expect(calls).toEqual([{ endpoint: 'comments/delete', args: ['c-1'] }]);
    expect(stdout).toContain('Deleted comment c-1');
  });
});
