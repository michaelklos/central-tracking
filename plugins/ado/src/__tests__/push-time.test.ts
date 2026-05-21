import { describe, it, expect, vi } from 'vitest';
import type { AdoConfig } from '../config';
import { pushTime, _internals } from '../push-time';
import type { CtTask, CtTimeEntry, JsonPatchOp, AdoWorkItem } from '../types';
import type { AdoClient } from '../ado-client';
import type { CtClient } from '../ct-client';
import type { AxiosError } from 'axios';

const { roundSecondsToHours, buildPatch, COMPLETED_WORK_FIELD } = _internals;

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
    tracksReported: true,
    stateMap: null,
    ...overrides,
  };
}

function makeTask(id: string, externalId: string | null, overrides: Partial<CtTask> = {}): CtTask {
  return {
    id,
    title: `#${externalId ?? '?'} - Task`,
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
    hasUnreportedTime: true,
    ...overrides,
  };
}

function makeEntry(taskId: string, durationSeconds: number | null, reportedAt: string | null = null): CtTimeEntry {
  return {
    id: `e-${Math.random()}`,
    taskId,
    startTime: '2026-05-18T10:00:00Z',
    endTime: '2026-05-18T11:00:00Z',
    durationSeconds,
    note: '',
    reportedAt,
    createdAt: '2026-05-18T10:00:00Z',
  };
}

function makeWorkItem(id: number, rev: number, completedHours: number): AdoWorkItem {
  return {
    id,
    rev,
    fields: {
      'System.Id': id,
      [COMPLETED_WORK_FIELD]: completedHours,
    },
    url: `https://dev.azure.com/org/proj/_apis/wit/workItems/${id}`,
  };
}

function makeAxios409(): AxiosError {
  const err = new Error('rev mismatch') as AxiosError;
  // Minimal AxiosError-like shape — we only branch on response.status.
  (err as unknown as { response: { status: number; data: unknown } }).response = {
    status: 409,
    data: { message: 'work item has been modified' },
  };
  return err;
}

function makeAxios400(): AxiosError {
  const err = new Error('bad request') as AxiosError;
  (err as unknown as { response: { status: number; data: unknown } }).response = {
    status: 400,
    data: { message: 'workflow rule denied' },
  };
  return err;
}

interface MockCt {
  getTasks: ReturnType<typeof vi.fn>;
  getTimeEntriesByTask: ReturnType<typeof vi.fn>;
  markTaskReported: ReturnType<typeof vi.fn>;
}

interface MockAdo {
  getWorkItem: ReturnType<typeof vi.fn>;
  patchWorkItem: ReturnType<typeof vi.fn>;
}

function makeMocks(
  tasks: CtTask[],
  entriesByTask: Record<string, CtTimeEntry[]>,
  workItems: Record<number, AdoWorkItem>,
): { ct: MockCt; ado: MockAdo } {
  const ct: MockCt = {
    getTasks: vi.fn().mockResolvedValue(tasks),
    getTimeEntriesByTask: vi.fn((taskId: string, opts?: { unreportedOnly?: boolean }) => {
      const list = entriesByTask[taskId] ?? [];
      return Promise.resolve(opts?.unreportedOnly ? list.filter((e) => e.reportedAt === null) : list);
    }),
    markTaskReported: vi.fn().mockResolvedValue({ changed: 1 }),
  };
  const ado: MockAdo = {
    getWorkItem: vi.fn((id: number) => Promise.resolve(workItems[id])),
    patchWorkItem: vi.fn(),
  };
  return { ct, ado };
}

function castMocks(m: { ct: MockCt; ado: MockAdo }): { ct: CtClient; ado: AdoClient } {
  return { ct: m.ct as unknown as CtClient, ado: m.ado as unknown as AdoClient };
}

describe('roundSecondsToHours', () => {
  // 30 min = 0.5h, 15 min bucket
  it('nearest rounds 30m to 0.5h', () => {
    expect(roundSecondsToHours(1800, 15, 'nearest')).toBe(0.5);
  });
  it('nearest rounds 7m to 0 (< half bucket)', () => {
    expect(roundSecondsToHours(7 * 60, 15, 'nearest')).toBe(0);
  });
  it('nearest rounds 8m to 0.25h (>= half bucket)', () => {
    expect(roundSecondsToHours(8 * 60, 15, 'nearest')).toBe(0.25);
  });
  it('up rounds 1m to 0.25h', () => {
    expect(roundSecondsToHours(60, 15, 'up')).toBe(0.25);
  });
  it('up rounds 0s to 0h (no work, no round-up)', () => {
    expect(roundSecondsToHours(0, 15, 'up')).toBe(0);
  });
  it('down rounds 14m to 0', () => {
    expect(roundSecondsToHours(14 * 60, 15, 'down')).toBe(0);
  });
  it('down rounds 16m to 0.25h', () => {
    expect(roundSecondsToHours(16 * 60, 15, 'down')).toBe(0.25);
  });
  it('respects custom bucket size', () => {
    expect(roundSecondsToHours(3600, 30, 'nearest')).toBe(1);
    expect(roundSecondsToHours(2700, 30, 'nearest')).toBe(1); // 45m → nearest 30m bucket = 60m
  });
  it('negative or non-positive seconds yield 0', () => {
    expect(roundSecondsToHours(-100, 15, 'nearest')).toBe(0);
    expect(roundSecondsToHours(0, 15, 'nearest')).toBe(0);
  });
});

describe('buildPatch', () => {
  it('emits a test op on /rev then add on /fields/CompletedWork', () => {
    const ops: JsonPatchOp[] = buildPatch(7, 3.25);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ op: 'test', path: '/rev', value: 7 });
    expect(ops[1]).toEqual({
      op: 'add',
      path: `/fields/${COMPLETED_WORK_FIELD}`,
      value: 3.25,
    });
  });
});

describe('pushTime', () => {
  it('sums unreported entries, rounds, PATCHes, marks reported', async () => {
    const task = makeTask('t1', '101');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 1800), makeEntry('t1', 900)] }, // 45m total
      { 101: makeWorkItem(101, 5, 2.0) },
    );
    m.ado.patchWorkItem.mockResolvedValue(makeWorkItem(101, 6, 2.75));
    const cfg = makeConfig({ roundMinutes: 15, roundMode: 'nearest' });

    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, cfg);

    expect(res.tasksPushed).toBe(1);
    expect(res.tasksFailed).toBe(0);
    expect(res.tasksSkippedZero).toBe(0);
    expect(res.hoursPushed).toBe(0.75);
    expect(m.ado.patchWorkItem).toHaveBeenCalledTimes(1);
    const [wiId, ops] = m.ado.patchWorkItem.mock.calls[0];
    expect(wiId).toBe(101);
    expect(ops[0]).toEqual({ op: 'test', path: '/rev', value: 5 });
    expect(ops[1].value).toBe(2.75); // 2.0 current + 0.75 delta
    expect(m.ct.markTaskReported).toHaveBeenCalledWith('t1', expect.any(String));
  });

  it('skips task when rounded delta is 0', async () => {
    const task = makeTask('t1', '101');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 60)] }, // 1m → rounds to 0 nearest
      { 101: makeWorkItem(101, 1, 0) },
    );
    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());

    expect(res.tasksPushed).toBe(0);
    expect(res.tasksSkippedZero).toBe(1);
    expect(m.ado.patchWorkItem).not.toHaveBeenCalled();
    expect(m.ct.markTaskReported).not.toHaveBeenCalled();
  });

  it('retries once on 409 then succeeds with refetched rev', async () => {
    const task = makeTask('t1', '101');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 1800)] }, // 30m → 0.5h
      { 101: makeWorkItem(101, 1, 1.0) },
    );
    m.ado.getWorkItem
      .mockResolvedValueOnce(makeWorkItem(101, 1, 1.0))
      .mockResolvedValueOnce(makeWorkItem(101, 2, 1.5));
    m.ado.patchWorkItem
      .mockRejectedValueOnce(makeAxios409())
      .mockResolvedValueOnce(makeWorkItem(101, 3, 2.0));

    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());

    expect(res.tasksPushed).toBe(1);
    expect(m.ado.patchWorkItem).toHaveBeenCalledTimes(2);
    expect(m.ado.getWorkItem).toHaveBeenCalledTimes(2);
    expect(m.ct.markTaskReported).toHaveBeenCalledTimes(1);
    // Second PATCH uses rev=2 + current 1.5 + 0.5 delta = 2.0
    const secondCallOps = m.ado.patchWorkItem.mock.calls[1][1];
    expect(secondCallOps[0]).toEqual({ op: 'test', path: '/rev', value: 2 });
    expect(secondCallOps[1].value).toBe(2.0);
  });

  it('fails task after two consecutive 409s (no third retry)', async () => {
    const task = makeTask('t1', '101');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 1800)] },
      { 101: makeWorkItem(101, 1, 0) },
    );
    m.ado.patchWorkItem.mockRejectedValue(makeAxios409());

    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());

    expect(res.tasksFailed).toBe(1);
    expect(res.tasksPushed).toBe(0);
    expect(m.ado.patchWorkItem).toHaveBeenCalledTimes(2);
    expect(m.ct.markTaskReported).not.toHaveBeenCalled();
    expect(res.warnings.some((w) => w.includes('PATCH failed'))).toBe(true);
  });

  it('does not retry on non-409 errors', async () => {
    const task = makeTask('t1', '101');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 1800)] },
      { 101: makeWorkItem(101, 1, 0) },
    );
    m.ado.patchWorkItem.mockRejectedValue(makeAxios400());

    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());

    expect(res.tasksFailed).toBe(1);
    expect(m.ado.patchWorkItem).toHaveBeenCalledTimes(1);
    expect(m.ct.markTaskReported).not.toHaveBeenCalled();
  });

  it('isolates failures across tasks (one fails, next succeeds)', async () => {
    const t1 = makeTask('t1', '101');
    const t2 = makeTask('t2', '102');
    const m = makeMocks(
      [t1, t2],
      {
        t1: [makeEntry('t1', 1800)],
        t2: [makeEntry('t2', 3600)],
      },
      {
        101: makeWorkItem(101, 1, 0),
        102: makeWorkItem(102, 1, 5),
      },
    );
    m.ado.patchWorkItem
      .mockRejectedValueOnce(makeAxios400()) // t1 fails
      .mockResolvedValueOnce(makeWorkItem(102, 2, 6)); // t2 succeeds

    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());

    expect(res.tasksConsidered).toBe(2);
    expect(res.tasksPushed).toBe(1);
    expect(res.tasksFailed).toBe(1);
    expect(res.hoursPushed).toBe(1);
    expect(m.ct.markTaskReported).toHaveBeenCalledTimes(1);
    expect(m.ct.markTaskReported).toHaveBeenCalledWith('t2', expect.any(String));
  });

  it('skips task with non-numeric external_id', async () => {
    const task = makeTask('t1', 'not-a-number');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 1800)] },
      {},
    );
    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());

    expect(res.tasksFailed).toBe(1);
    expect(m.ado.patchWorkItem).not.toHaveBeenCalled();
    expect(m.ct.markTaskReported).not.toHaveBeenCalled();
  });

  it('skips task with null external_id', async () => {
    const task = makeTask('t1', null);
    const m = makeMocks([task], { t1: [makeEntry('t1', 1800)] }, {});
    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());
    expect(res.tasksFailed).toBe(1);
  });

  it('skips-zero when entries list is empty', async () => {
    const task = makeTask('t1', '101');
    const m = makeMocks([task], { t1: [] }, { 101: makeWorkItem(101, 1, 0) });
    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());
    expect(res.tasksSkippedZero).toBe(1);
    expect(m.ado.patchWorkItem).not.toHaveBeenCalled();
  });

  it('rounds independently per task (does not pool seconds)', async () => {
    // 2 tasks each 7m → each rounds to 0 nearest; neither pushes.
    const t1 = makeTask('t1', '101');
    const t2 = makeTask('t2', '102');
    const m = makeMocks(
      [t1, t2],
      { t1: [makeEntry('t1', 420)], t2: [makeEntry('t2', 420)] },
      { 101: makeWorkItem(101, 1, 0), 102: makeWorkItem(102, 1, 0) },
    );
    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());
    expect(res.tasksPushed).toBe(0);
    expect(res.tasksSkippedZero).toBe(2);
  });

  it('uses round-mode=up to push even tiny deltas', async () => {
    const task = makeTask('t1', '101');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 60)] }, // 1m
      { 101: makeWorkItem(101, 1, 0) },
    );
    m.ado.patchWorkItem.mockResolvedValue(makeWorkItem(101, 2, 0.25));
    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig({ roundMode: 'up' }));
    expect(res.tasksPushed).toBe(1);
    expect(res.hoursPushed).toBe(0.25);
    const ops = m.ado.patchWorkItem.mock.calls[0][1];
    expect(ops[1].value).toBe(0.25);
  });

  it('filters tasks by source=ado and hasUnreportedTime', async () => {
    // Verify the filter is passed correctly to ct.getTasks.
    const m = makeMocks([], {}, {});
    await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig());
    expect(m.ct.getTasks).toHaveBeenCalledWith({ pluginId: 'ado', hasUnreportedTime: true });
  });

  it('does not call markTaskReported if PATCH succeeds but mark throws — propagates', async () => {
    // Sanity: if markTaskReported throws, we propagate (don't silently swallow).
    const task = makeTask('t1', '101');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 1800)] },
      { 101: makeWorkItem(101, 1, 0) },
    );
    m.ado.patchWorkItem.mockResolvedValue(makeWorkItem(101, 2, 0.5));
    m.ct.markTaskReported.mockRejectedValue(new Error('db locked'));
    await expect(pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig())).rejects.toThrow('db locked');
  });

  it('skips markTaskReported when tracksReported=false (user manages reported state)', async () => {
    const task = makeTask('t1', '101');
    const m = makeMocks(
      [task],
      { t1: [makeEntry('t1', 1800)] },
      { 101: makeWorkItem(101, 1, 0) },
    );
    m.ado.patchWorkItem.mockResolvedValue(makeWorkItem(101, 2, 0.5));

    const res = await pushTime(castMocks(m).ado, castMocks(m).ct, makeConfig({ tracksReported: false }));

    expect(res.tasksPushed).toBe(1);
    expect(m.ado.patchWorkItem).toHaveBeenCalledTimes(1);
    expect(m.ct.markTaskReported).not.toHaveBeenCalled();
  });
});
