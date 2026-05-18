import { describe, it, expect, vi } from 'vitest';
import type { AxiosError } from 'axios';
import type { AdoClient } from '../ado-client';
import type { CtClient } from '../ct-client';
import { pushComments, _internals } from '../push-comments';
import type { CtPendingSyncComment } from '../types';

const { renderMarkdown } = _internals;

function makeComment(
  id: string,
  taskExternalId: string | null,
  body: string,
  overrides: Partial<CtPendingSyncComment> = {},
): CtPendingSyncComment {
  return {
    id,
    taskId: `task-of-${id}`,
    body,
    syncable: true,
    synced: false,
    externalId: null,
    taskExternalId,
    taskSource: 'ado',
    ...overrides,
  };
}

function axiosErr(status: number, message: string): AxiosError {
  const err = new Error(message) as AxiosError;
  (err as unknown as { response: { status: number; data: unknown } }).response = {
    status,
    data: { message },
  };
  return err;
}

interface MockCt {
  getPendingSyncComments: ReturnType<typeof vi.fn>;
  updateComment: ReturnType<typeof vi.fn>;
}
interface MockAdo {
  postWorkItemComment: ReturnType<typeof vi.fn>;
}

function makeMocks(comments: CtPendingSyncComment[]): { ct: MockCt; ado: MockAdo } {
  return {
    ct: {
      getPendingSyncComments: vi.fn().mockResolvedValue(comments),
      updateComment: vi.fn().mockResolvedValue({}),
    },
    ado: {
      postWorkItemComment: vi.fn(),
    },
  };
}

function cast(m: { ct: MockCt; ado: MockAdo }): { ct: CtClient; ado: AdoClient } {
  return { ct: m.ct as unknown as CtClient, ado: m.ado as unknown as AdoClient };
}

describe('renderMarkdown', () => {
  it('renders **bold** to <strong>', () => {
    const html = renderMarkdown('hello **world**');
    expect(html).toContain('<strong>world</strong>');
  });
  it('returns a string (sync mode, not a Promise)', () => {
    const result = renderMarkdown('plain');
    expect(typeof result).toBe('string');
  });
});

describe('pushComments', () => {
  it('POSTs each pending comment as HTML and stamps synced=true with returned id', async () => {
    const comments = [makeComment('c1', '42', 'hello')];
    const m = makeMocks(comments);
    m.ado.postWorkItemComment.mockResolvedValue({ id: 9001 });

    const res = await pushComments(cast(m).ado, cast(m).ct);

    expect(res.pushed).toBe(1);
    expect(res.failed).toBe(0);
    expect(m.ct.getPendingSyncComments).toHaveBeenCalledWith('ado');
    const [workItemId, html] = m.ado.postWorkItemComment.mock.calls[0];
    expect(workItemId).toBe(42);
    expect(html).toContain('hello');
    expect(m.ct.updateComment).toHaveBeenCalledWith('c1', {
      synced: true,
      externalId: '9001',
    });
  });

  it('leaves synced=false and logs on POST failure (no updateComment)', async () => {
    const comments = [makeComment('c1', '42', 'hi')];
    const m = makeMocks(comments);
    m.ado.postWorkItemComment.mockRejectedValue(axiosErr(500, 'down'));

    const res = await pushComments(cast(m).ado, cast(m).ct);

    expect(res.pushed).toBe(0);
    expect(res.failed).toBe(1);
    expect(m.ct.updateComment).not.toHaveBeenCalled();
    expect(res.warnings.some((w) => w.includes('POST failed'))).toBe(true);
  });

  it('isolates failures across comments', async () => {
    const m = makeMocks([
      makeComment('c1', '101', 'one'),
      makeComment('c2', '102', 'two'),
    ]);
    m.ado.postWorkItemComment
      .mockRejectedValueOnce(axiosErr(500, 'first failed'))
      .mockResolvedValueOnce({ id: 7 });

    const res = await pushComments(cast(m).ado, cast(m).ct);

    expect(res.pushed).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.considered).toBe(2);
    expect(m.ct.updateComment).toHaveBeenCalledTimes(1);
    expect(m.ct.updateComment).toHaveBeenCalledWith('c2', {
      synced: true,
      externalId: '7',
    });
  });

  it('skips comment whose task has null external_id', async () => {
    const m = makeMocks([makeComment('c1', null, 'x')]);
    const res = await pushComments(cast(m).ado, cast(m).ct);

    expect(res.failed).toBe(1);
    expect(m.ado.postWorkItemComment).not.toHaveBeenCalled();
    expect(res.warnings.some((w) => w.includes('no external_id'))).toBe(true);
  });

  it('skips comment with non-numeric external_id', async () => {
    const m = makeMocks([makeComment('c1', 'not-a-num', 'x')]);
    const res = await pushComments(cast(m).ado, cast(m).ct);

    expect(res.failed).toBe(1);
    expect(m.ado.postWorkItemComment).not.toHaveBeenCalled();
  });

  it('propagates updateComment failure after a successful POST (no double-post on next run)', async () => {
    const m = makeMocks([makeComment('c1', '42', 'hi')]);
    m.ado.postWorkItemComment.mockResolvedValue({ id: 9 });
    m.ct.updateComment.mockRejectedValue(new Error('ct down'));

    await expect(pushComments(cast(m).ado, cast(m).ct)).rejects.toThrow('ct down');
  });
});
