import { describe, it, expect, vi } from 'vitest';
import type { AdoClient } from '../ado-client';
import type { CtClient } from '../ct-client';
import type { AdoConfig } from '../config';
import { sync, _internals } from '../sync';
import type { CtTask, CtTimeEntry, PushedTaskBatch } from '../push-time';

const { buildAutoCommentBody, formatHours } = _internals as unknown as {
  buildAutoCommentBody: (b: PushedTaskBatch, today?: string) => string;
  formatHours: (h: number) => string;
};

function makeConfig(overrides: Partial<AdoConfig> = {}): AdoConfig {
  return {
    pat: 'x',
    organization: 'org',
    project: 'proj',
    team: 'team',
    roundMinutes: 15,
    roundMode: 'nearest',
    workItemTypes: ['Task'],
    pullClosed: false,
    autoCommentOnTimePush: false,
    stateMap: null,
    ...overrides,
  };
}

function makeTask(id: string, externalId: string | null): CtTask {
  return {
    id,
    title: `#${externalId} - t`,
    status: 'in-progress',
    source: 'plugin',
    pluginId: 'ado',
    externalId,
    externalUrl: null,
    externalState: 'Active',
    externalCompletedHours: 0,
    externalRefreshedAt: null,
    stateDirty: false,
    notes: '',
    unreportedTimeSeconds: 0,
    hasUnreportedTime: false,
  };
}

function makeEntry(taskId: string, durationSeconds: number, note = ''): CtTimeEntry {
  return {
    id: `e-${Math.random()}`,
    taskId,
    startTime: '2026-05-18T10:00:00Z',
    endTime: '2026-05-18T11:00:00Z',
    durationSeconds,
    note,
    reportedAt: null,
    createdAt: '2026-05-18T10:00:00Z',
  };
}

function makeAdo(overrides: Partial<Record<string, unknown>> = {}): AdoClient {
  return {
    getCurrentIteration: vi.fn().mockResolvedValue({ path: 'Proj\\Iter' }),
    wiqlQuery: vi.fn().mockResolvedValue([]),
    getWorkItems: vi.fn().mockResolvedValue([]),
    getWorkItem: vi.fn(),
    getWorkItemComments: vi.fn().mockResolvedValue([]),
    patchWorkItem: vi.fn(),
    postWorkItemComment: vi.fn().mockResolvedValue({ id: 1 }),
    ...overrides,
  } as unknown as AdoClient;
}

function makeCt(overrides: Partial<Record<string, unknown>> = {}): CtClient {
  return {
    pluginId: 'ado',
    listPluginConfig: vi.fn().mockResolvedValue([]),
    getPluginConfig: vi.fn().mockResolvedValue(null),
    getTaskById: vi.fn(),
    getTasks: vi.fn().mockResolvedValue([]),
    upsertExternalTask: vi.fn(),
    setExternalTaskState: vi.fn().mockResolvedValue({ ok: true }),
    getTimeEntriesByTask: vi.fn().mockResolvedValue([]),
    markTaskReported: vi.fn().mockResolvedValue({ changed: 0 }),
    upsertExternalComment: vi.fn(),
    getPendingSyncComments: vi.fn().mockResolvedValue([]),
    updateComment: vi.fn(),
    ...overrides,
  } as unknown as CtClient;
}

describe('formatHours', () => {
  it('renders 0.75h as 45m', () => {
    expect(formatHours(0.75)).toBe('45m');
  });
  it('renders 1.5h as "1h 30m"', () => {
    expect(formatHours(1.5)).toBe('1h 30m');
  });
  it('renders 2h cleanly', () => {
    expect(formatHours(2)).toBe('2h');
  });
});

describe('buildAutoCommentBody', () => {
  it('skips note list when no entry has a note', () => {
    const batch: PushedTaskBatch = {
      task: makeTask('t1', '1'),
      hoursPushed: 0.5,
      entries: [makeEntry('t1', 1800, '')],
    };
    expect(buildAutoCommentBody(batch, '2026-05-18')).toBe(
      '+30m logged 2026-05-18:',
    );
  });
  it('includes one bullet per non-empty note', () => {
    const batch: PushedTaskBatch = {
      task: makeTask('t1', '1'),
      hoursPushed: 1.0,
      entries: [makeEntry('t1', 1800, 'spec'), makeEntry('t1', 1800, '  '), makeEntry('t1', 1800, 'impl')],
    };
    expect(buildAutoCommentBody(batch, '2026-05-18')).toBe(
      '+1h logged 2026-05-18:\n- spec\n- impl',
    );
  });
});

describe('sync orchestrator', () => {
  it('runs push-state → push-time → push-comments → pull in order', async () => {
    const order: string[] = [];
    const ct = makeCt({
      getTasks: vi.fn(async (filter: { stateDirty?: boolean; hasUnreportedTime?: boolean }) => {
        if (filter.stateDirty) order.push('state');
        else if (filter.hasUnreportedTime) order.push('time');
        else order.push('pull-tasks');
        return [];
      }),
      getPendingSyncComments: vi.fn(async () => {
        order.push('comments');
        return [];
      }),
    });
    const ado = makeAdo({
      getCurrentIteration: vi.fn(async () => {
        order.push('pull-iter');
        return { path: 'p' };
      }),
    });

    await sync(ado, ct, makeConfig());
    // pull starts with iteration lookup. state and time run before pull/comments.
    expect(order[0]).toBe('state');
    expect(order[1]).toBe('time');
    expect(order).toContain('comments');
    expect(order).toContain('pull-iter');
    expect(order.indexOf('state')).toBeLessThan(order.indexOf('comments'));
  });

  it('does NOT call postWorkItemComment for auto-comments when flag is off', async () => {
    const ado = makeAdo();
    const ct = makeCt();
    await sync(ado, ct, makeConfig({ autoCommentOnTimePush: false }));
    expect((ado.postWorkItemComment as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('posts auto-comments after time push when flag is on', async () => {
    const task = makeTask('t1', '42');
    const entries = [makeEntry('t1', 1800, 'wrote spec')];
    const ct = makeCt({
      getTasks: vi.fn(async (filter: { stateDirty?: boolean; hasUnreportedTime?: boolean }) => {
        if (filter.hasUnreportedTime) return [task];
        return [];
      }),
      getTimeEntriesByTask: vi.fn().mockResolvedValue(entries),
    });
    const wi = { id: 42, rev: 1, fields: { 'System.Id': 42, 'Microsoft.VSTS.Scheduling.CompletedWork': 0 }, url: '' };
    const ado = makeAdo({
      getWorkItem: vi.fn().mockResolvedValue(wi),
      patchWorkItem: vi.fn().mockResolvedValue(wi),
    });

    await sync(ado, ct, makeConfig({ autoCommentOnTimePush: true }));

    const post = ado.postWorkItemComment as ReturnType<typeof vi.fn>;
    expect(post).toHaveBeenCalledTimes(1);
    const [wid, body] = post.mock.calls[0];
    expect(wid).toBe(42);
    expect(body).toContain('logged');
    expect(body).toContain('wrote spec');
  });

  it('auto-comment failure does not throw the sync', async () => {
    const task = makeTask('t1', '42');
    const ct = makeCt({
      getTasks: vi.fn(async (filter: { hasUnreportedTime?: boolean }) =>
        filter.hasUnreportedTime ? [task] : [],
      ),
      getTimeEntriesByTask: vi.fn().mockResolvedValue([makeEntry('t1', 1800, 'x')]),
    });
    const wi = { id: 42, rev: 1, fields: { 'System.Id': 42, 'Microsoft.VSTS.Scheduling.CompletedWork': 0 }, url: '' };
    const ado = makeAdo({
      getWorkItem: vi.fn().mockResolvedValue(wi),
      patchWorkItem: vi.fn().mockResolvedValue(wi),
      postWorkItemComment: vi.fn().mockRejectedValue(new Error('ado down')),
    });

    const res = await sync(ado, ct, makeConfig({ autoCommentOnTimePush: true }));
    expect(res.autoComments.failed).toBe(1);
    expect(res.autoComments.warnings.some((w) => w.includes('POST failed'))).toBe(true);
  });
});
