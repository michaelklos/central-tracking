import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTaskHandlers } from '../taskHandlers';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('Task Sort Options', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;
  let timeIpc: ReturnType<typeof createMockIpcMain>;

  beforeEach(() => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    timeIpc = createMockIpcMain();
    registerTaskHandlers(ipc as never, db);
    registerTimeEntryHandlers(timeIpc as never, db);
  });

  afterEach(() => {
    db.close();
  });

  it('defaults to manual sort order (sort_order ASC)', async () => {
    await ipc.invoke('tasks:create', { title: 'C' });
    await ipc.invoke('tasks:create', { title: 'A' });
    await ipc.invoke('tasks:create', { title: 'B' });

    const result = await ipc.invoke('tasks:getActive');
    expect(result.items[0].title).toBe('C');
    expect(result.items[1].title).toBe('A');
    expect(result.items[2].title).toBe('B');
  });

  it('sorts by manual when explicitly requested', async () => {
    await ipc.invoke('tasks:create', { title: 'C' });
    await ipc.invoke('tasks:create', { title: 'A' });
    await ipc.invoke('tasks:create', { title: 'B' });

    const result = await ipc.invoke('tasks:getActive', { sortBy: 'manual' });
    expect(result.items[0].title).toBe('C');
    expect(result.items[1].title).toBe('A');
    expect(result.items[2].title).toBe('B');
  });

  it('sorts alphabetically', async () => {
    await ipc.invoke('tasks:create', { title: 'Charlie' });
    await ipc.invoke('tasks:create', { title: 'alpha' });
    await ipc.invoke('tasks:create', { title: 'Bravo' });

    const result = await ipc.invoke('tasks:getActive', { sortBy: 'alphabetical' });
    expect(result.items[0].title).toBe('alpha');
    expect(result.items[1].title).toBe('Bravo');
    expect(result.items[2].title).toBe('Charlie');
  });

  it('sorts by created date (newest first)', async () => {
    const t1 = await ipc.invoke('tasks:create', { title: 'First' });
    const t2 = await ipc.invoke('tasks:create', { title: 'Second' });
    const t3 = await ipc.invoke('tasks:create', { title: 'Third' });

    const result = await ipc.invoke('tasks:getActive', { sortBy: 'created' });
    expect(result.items[0].title).toBe('Third');
    expect(result.items[1].title).toBe('Second');
    expect(result.items[2].title).toBe('First');
  });

  it('sorts by recent activity (most recently worked first)', async () => {
    const t1 = await ipc.invoke('tasks:create', { title: 'OldWork' });
    const t2 = await ipc.invoke('tasks:create', { title: 'NewWork' });
    const t3 = await ipc.invoke('tasks:create', { title: 'NoWork' });

    // Create a completed time entry for t1 (older)
    await timeIpc.invoke('timeEntries:create', {
      taskId: t1.id,
      startTime: '2026-03-01T08:00:00Z',
      endTime: '2026-03-01T09:00:00Z',
    });

    // Create a completed time entry for t2 (newer)
    await timeIpc.invoke('timeEntries:create', {
      taskId: t2.id,
      startTime: '2026-03-05T08:00:00Z',
      endTime: '2026-03-05T09:00:00Z',
    });

    const result = await ipc.invoke('tasks:getActive', { sortBy: 'recent' });
    // NewWork has more recent activity, then OldWork, then NoWork (null last)
    expect(result.items[0].title).toBe('NewWork');
    expect(result.items[1].title).toBe('OldWork');
    expect(result.items[2].title).toBe('NoWork');
  });

  it('sorts by most time today', async () => {
    const t1 = await ipc.invoke('tasks:create', { title: 'LittleTime' });
    const t2 = await ipc.invoke('tasks:create', { title: 'LotsOfTime' });
    const t3 = await ipc.invoke('tasks:create', { title: 'NoTime' });

    // Anchor entries to "now" so they always fall on the local "today" the
    // handler queries (`date(start_time, 'localtime') = date('now', 'localtime')`).
    // Using UTC today directly would put entries on tomorrow's local date in
    // late-evening US timezones, sinking "today's time" to 0.
    const now = Date.now();
    const tEnd1 = new Date(now - 30 * 60_000); // 30m ago
    const tStart1 = new Date(now - 60 * 60_000); // 1h ago
    const tEnd2 = new Date(now - 60 * 60_000); // 1h ago
    const tStart2 = new Date(now - 3 * 60 * 60_000); // 3h ago

    // t1: 30 min today
    await timeIpc.invoke('timeEntries:create', {
      taskId: t1.id,
      startTime: tStart1.toISOString(),
      endTime: tEnd1.toISOString(),
    });

    // t2: 2 hours today
    await timeIpc.invoke('timeEntries:create', {
      taskId: t2.id,
      startTime: tStart2.toISOString(),
      endTime: tEnd2.toISOString(),
    });

    const result = await ipc.invoke('tasks:getActive', { sortBy: 'most-time-today' });
    expect(result.items[0].title).toBe('LotsOfTime');
    expect(result.items[1].title).toBe('LittleTime');
    expect(result.items[2].title).toBe('NoTime');
  });

  it('sorts done tasks by recent activity', async () => {
    const t1 = await ipc.invoke('tasks:create', { title: 'DoneOld' });
    await ipc.invoke('tasks:update', t1.id, { status: 'done' });
    const t2 = await ipc.invoke('tasks:create', { title: 'DoneNew' });
    await ipc.invoke('tasks:update', t2.id, { status: 'done' });

    await timeIpc.invoke('timeEntries:create', {
      taskId: t1.id,
      startTime: '2026-03-01T08:00:00Z',
      endTime: '2026-03-01T09:00:00Z',
    });
    await timeIpc.invoke('timeEntries:create', {
      taskId: t2.id,
      startTime: '2026-03-06T08:00:00Z',
      endTime: '2026-03-06T09:00:00Z',
    });

    const result = await ipc.invoke('tasks:getDone', { sortBy: 'recent' });
    expect(result.items[0].title).toBe('DoneNew');
    expect(result.items[1].title).toBe('DoneOld');
  });
});
