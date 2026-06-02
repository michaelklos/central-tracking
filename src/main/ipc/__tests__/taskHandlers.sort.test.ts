import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTaskHandlers } from '../taskHandlers';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

/**
 * Return an ISO UTC string for today at the given local hour, safe to use in
 * queries filtered by date(start_time, 'localtime') = date('now', 'localtime').
 */
function todayLocalIso(hourLocal: number, minuteLocal: number = 0): string {
  const now = new Date();
  const local = new Date(
    `${now.toLocaleDateString('en-CA')}T${String(hourLocal).padStart(2, '0')}:${String(minuteLocal).padStart(2, '0')}:00`
  );
  return local.toISOString();
}

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
    await ipc.invoke('tasks:create', { title: 'First' });
    await ipc.invoke('tasks:create', { title: 'Second' });
    await ipc.invoke('tasks:create', { title: 'Third' });

    const result = await ipc.invoke('tasks:getActive', { sortBy: 'created' });
    expect(result.items[0].title).toBe('Third');
    expect(result.items[1].title).toBe('Second');
    expect(result.items[2].title).toBe('First');
  });

  it('sorts by recent activity (most recently worked first)', async () => {
    const t1 = await ipc.invoke('tasks:create', { title: 'OldWork' });
    const t2 = await ipc.invoke('tasks:create', { title: 'NewWork' });
    await ipc.invoke('tasks:create', { title: 'NoWork' });

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

    // Use local-noon anchored times so entries always land on today regardless
    // of the host's UTC offset (a UTC-based subtraction from "now" can cross
    // midnight in the local timezone for users in negative-offset zones).
    // t1: 30 min today  (10:00–10:30 local)
    await timeIpc.invoke('timeEntries:create', {
      taskId: t1.id,
      startTime: todayLocalIso(10, 0),
      endTime:   todayLocalIso(10, 30),
    });

    // t2: 2 hours today  (11:00–13:00 local)
    await timeIpc.invoke('timeEntries:create', {
      taskId: t2.id,
      startTime: todayLocalIso(11, 0),
      endTime:   todayLocalIso(13, 0),
    });

    // suppress unused variable warning
    void t3;

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
