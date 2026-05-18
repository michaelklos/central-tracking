import { describe, it, expect, vi } from 'vitest';
import type { AxiosError } from 'axios';
import type { AdoClient } from '../ado-client';
import type { CtClient } from '../ct-client';
import type { AdoConfig } from '../config';
import { pushState, _internals } from '../push-state';
import type { AdoWorkItem, CtTask, CtTaskStatus } from '../types';

const { isAllowed, STATE_FIELD } = _internals;

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

function makeTask(
  id: string,
  externalId: string | null,
  status: CtTaskStatus,
  externalState: string | null,
  overrides: Partial<CtTask> = {},
): CtTask {
  return {
    id,
    title: `#${externalId ?? '?'} - Task`,
    status,
    source: 'ado',
    externalId,
    externalUrl: null,
    externalState,
    externalCompletedHours: 0,
    externalRefreshedAt: null,
    stateDirty: true,
    notes: '',
    unreportedTimeSeconds: 0,
    hasUnreportedTime: false,
    ...overrides,
  };
}

function makeWorkItem(id: number, rev: number, state = 'Active'): AdoWorkItem {
  return {
    id,
    rev,
    fields: { 'System.Id': id, [STATE_FIELD]: state },
    url: `https://dev.azure.com/org/proj/_apis/wit/workItems/${id}`,
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
  getTasks: ReturnType<typeof vi.fn>;
  setExternalTaskState: ReturnType<typeof vi.fn>;
}
interface MockAdo {
  getWorkItem: ReturnType<typeof vi.fn>;
  patchWorkItem: ReturnType<typeof vi.fn>;
}

function makeMocks(
  tasks: CtTask[],
  workItems: Record<number, AdoWorkItem>,
): { ct: MockCt; ado: MockAdo } {
  return {
    ct: {
      getTasks: vi.fn().mockResolvedValue(tasks),
      setExternalTaskState: vi.fn().mockResolvedValue({ ok: true }),
    },
    ado: {
      getWorkItem: vi.fn((id: number) => Promise.resolve(workItems[id])),
      patchWorkItem: vi.fn(),
    },
  };
}

function cast(m: { ct: MockCt; ado: MockAdo }): { ct: CtClient; ado: AdoClient } {
  return { ct: m.ct as unknown as CtClient, ado: m.ado as unknown as AdoClient };
}

describe('isAllowed', () => {
  it.each([
    ['todo', 'in-progress', true],
    ['todo', 'done', true],
    ['todo', 'blocked', true],
    ['in-progress', 'done', true],
    ['in-progress', 'blocked', true],
    ['done', 'in-progress', true],
    ['done', 'blocked', true],
    ['blocked', 'todo', true],
    ['blocked', 'in-progress', true],
    ['blocked', 'done', true],
    ['in-progress', 'todo', false],
    ['done', 'todo', false],
  ] as [CtTaskStatus, CtTaskStatus, boolean][])(
    '%s → %s = %s',
    (from, to, expected) => {
      expect(isAllowed(from, to)).toBe(expected);
    },
  );
  it('same status is always allowed (no-op)', () => {
    expect(isAllowed('done', 'done')).toBe(true);
  });
});

describe('pushState', () => {
  it('PATCHes new state and clears state_dirty on success', async () => {
    const task = makeTask('t1', '101', 'done', 'Active');
    const m = makeMocks([task], { 101: makeWorkItem(101, 7, 'Active') });
    m.ado.patchWorkItem.mockResolvedValue(makeWorkItem(101, 8, 'Closed'));

    const res = await pushState(cast(m).ado, cast(m).ct, makeConfig());

    expect(res.pushed).toBe(1);
    expect(res.failed).toBe(0);
    const [wiId, ops] = m.ado.patchWorkItem.mock.calls[0];
    expect(wiId).toBe(101);
    expect(ops[0]).toEqual({ op: 'test', path: '/rev', value: 7 });
    expect(ops[1]).toEqual({ op: 'add', path: `/fields/${STATE_FIELD}`, value: 'Closed' });
    expect(m.ct.setExternalTaskState).toHaveBeenCalledWith('t1', 'Closed');
  });

  it('skips blocked tasks with a warning and leaves state_dirty set', async () => {
    const task = makeTask('t1', '101', 'blocked', 'Active');
    const m = makeMocks([task], { 101: makeWorkItem(101, 1, 'Active') });

    const res = await pushState(cast(m).ado, cast(m).ct, makeConfig());

    expect(res.skippedBlocked).toBe(1);
    expect(res.pushed).toBe(0);
    expect(m.ado.patchWorkItem).not.toHaveBeenCalled();
    expect(m.ct.setExternalTaskState).not.toHaveBeenCalled();
    expect(res.warnings.some((w) => w.includes('blocked'))).toBe(true);
  });

  it('retries once on 409 with refreshed rev', async () => {
    const task = makeTask('t1', '101', 'done', 'Active');
    const m = makeMocks([task], { 101: makeWorkItem(101, 1, 'Active') });
    m.ado.getWorkItem
      .mockResolvedValueOnce(makeWorkItem(101, 1, 'Active'))
      .mockResolvedValueOnce(makeWorkItem(101, 2, 'Active'));
    m.ado.patchWorkItem
      .mockRejectedValueOnce(axiosErr(409, 'rev mismatch'))
      .mockResolvedValueOnce(makeWorkItem(101, 3, 'Closed'));

    const res = await pushState(cast(m).ado, cast(m).ct, makeConfig());

    expect(res.pushed).toBe(1);
    expect(m.ado.patchWorkItem).toHaveBeenCalledTimes(2);
    expect(m.ado.patchWorkItem.mock.calls[1][1][0]).toEqual({
      op: 'test',
      path: '/rev',
      value: 2,
    });
  });

  it('logs and bails on 400 (workflow rule) without clearing dirty', async () => {
    const task = makeTask('t1', '101', 'done', 'Active');
    const m = makeMocks([task], { 101: makeWorkItem(101, 1, 'Active') });
    m.ado.patchWorkItem.mockRejectedValue(axiosErr(400, 'TF401320'));

    const res = await pushState(cast(m).ado, cast(m).ct, makeConfig());

    expect(res.rejectedByWorkflow).toBe(1);
    expect(res.pushed).toBe(0);
    expect(m.ct.setExternalTaskState).not.toHaveBeenCalled();
    expect(res.warnings.some((w) => w.includes('ADO rejected'))).toBe(true);
  });

  it('skips when ct status has no ADO mapping (custom config without entry)', async () => {
    const task = makeTask('t1', '101', 'todo', 'Active');
    const m = makeMocks([task], { 101: makeWorkItem(101, 1, 'Active') });
    const cfg = makeConfig({
      stateMap: { done: { ado: 'Closed', altIn: ['Closed'] } },
    });

    const res = await pushState(cast(m).ado, cast(m).ct, cfg);

    expect(res.failed).toBe(1);
    expect(m.ado.patchWorkItem).not.toHaveBeenCalled();
  });

  it('skips task with non-numeric external_id', async () => {
    const task = makeTask('t1', 'abc', 'done', 'Active');
    const m = makeMocks([task], {});
    const res = await pushState(cast(m).ado, cast(m).ct, makeConfig());
    expect(res.failed).toBe(1);
    expect(m.ado.patchWorkItem).not.toHaveBeenCalled();
  });

  it('bails when prior ADO state maps to a ct status that cannot legally reach target', async () => {
    // external_state="Active" → inverse maps to "in-progress". in-progress → todo is disallowed.
    const task = makeTask('t1', '101', 'todo', 'Active');
    const m = makeMocks([task], { 101: makeWorkItem(101, 1, 'Active') });

    const res = await pushState(cast(m).ado, cast(m).ct, makeConfig());

    expect(res.failed).toBe(1);
    expect(m.ado.patchWorkItem).not.toHaveBeenCalled();
    expect(res.warnings.some((w) => w.includes('not an allowed transition'))).toBe(true);
  });

  it('passes the stateDirty filter to ct.getTasks', async () => {
    const m = makeMocks([], {});
    await pushState(cast(m).ado, cast(m).ct, makeConfig());
    expect(m.ct.getTasks).toHaveBeenCalledWith({ source: ['ado'], stateDirty: true });
  });

  it('propagates setExternalTaskState failure after a successful PATCH', async () => {
    // If swallowed, ADO has new state but ct keeps state_dirty=1 with stale external_state.
    const task = makeTask('t1', '101', 'done', 'Active');
    const m = makeMocks([task], { 101: makeWorkItem(101, 1, 'Active') });
    m.ado.patchWorkItem.mockResolvedValue(makeWorkItem(101, 2, 'Closed'));
    m.ct.setExternalTaskState.mockRejectedValue(new Error('ct down'));

    await expect(pushState(cast(m).ado, cast(m).ct, makeConfig())).rejects.toThrow('ct down');
  });
});
