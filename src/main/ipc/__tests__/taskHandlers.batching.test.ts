import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../../database/database';
import { createTask, getActiveTasks, getAllTasks, getTaskById } from '../taskHandlers';
import { createTimeEntry, updateTimeEntry } from '../timeEntryHandlers';
import { createCategory, assignCategoriesToTask } from '../categoryHandlers';

/** ISO UTC string for today at a given local hour. */
function todayLocalIso(hourLocal: number, minuteLocal = 0): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hourLocal, minuteLocal, 0).toISOString();
}

describe('building a page of tasks', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('does not scale its query count with the size of the page', () => {
    for (let i = 0; i < 20; i++) createTask(db, { title: `Task ${i}` });

    const prepare = vi.spyOn(db.instance, 'prepare');
    getActiveTasks(db, { offset: 0, limit: 20 });
    const queriesFor20 = prepare.mock.calls.length;
    prepare.mockRestore();

    for (let i = 20; i < 60; i++) createTask(db, { title: `Task ${i}` });

    const prepare2 = vi.spyOn(db.instance, 'prepare');
    const page = getActiveTasks(db, { offset: 0, limit: 60 });
    const queriesFor60 = prepare2.mock.calls.length;
    prepare2.mockRestore();

    expect(page.items).toHaveLength(60);
    // Tripling the page must not triple the round trips. Before batching this
    // was 4N+2: 82 versus 242.
    expect(queriesFor60).toBe(queriesFor20);
    expect(queriesFor60).toBeLessThan(10);
  });

  it('still reports each task its own categories and totals', () => {
    const a = createTask(db, { title: 'A' });
    const b = createTask(db, { title: 'B' });
    const cat = createCategory(db, { name: 'Bug', color: '#f00' });
    assignCategoriesToTask(db, a.id, [cat.id]);

    // One finished hour today on A, one finished hour today on B that is
    // already reported, plus a running entry on B that must count as zero.
    const e1 = createTimeEntry(db, { taskId: a.id, startTime: todayLocalIso(9) });
    updateTimeEntry(db, e1.id, { endTime: todayLocalIso(10) });
    const e2 = createTimeEntry(db, { taskId: b.id, startTime: todayLocalIso(11) });
    updateTimeEntry(db, e2.id, { endTime: todayLocalIso(12), reportedAt: todayLocalIso(13) });
    createTimeEntry(db, { taskId: b.id, startTime: todayLocalIso(14) });

    const byId = new Map(getActiveTasks(db, {}).items.map((t) => [t.id, t]));
    const taskA = byId.get(a.id)!;
    const taskB = byId.get(b.id)!;

    expect(taskA.categoryIds).toEqual([cat.id]);
    expect(taskB.categoryIds).toEqual([]);
    expect(taskA.totalTimeSeconds).toBe(3600);
    expect(taskA.todayTimeSeconds).toBe(3600);
    expect(taskA.unreportedTimeSeconds).toBe(3600);
    expect(taskA.hasUnreportedTime).toBe(true);
    // B's running entry contributes nothing, and its finished hour is reported.
    expect(taskB.totalTimeSeconds).toBe(3600);
    expect(taskB.unreportedTimeSeconds).toBe(0);
    expect(taskB.hasUnreportedTime).toBe(false);

    // The single-row path agrees with the page path.
    expect(getTaskById(db, a.id)).toEqual(taskA);
  });
});

describe('getAllTasks filtering', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('filters by plugin, unreported time and state_dirty in SQL', () => {
    for (const id of ['ado', 'jira']) {
      db.instance.prepare('INSERT INTO plugins (id, name) VALUES (?, ?)').run(id, id);
    }
    const mine = createTask(db, { title: 'Mine' });
    const theirs = createTask(db, { title: 'Theirs', source: 'plugin', pluginId: 'ado', externalId: '1' });
    createTask(db, { title: 'Other plugin', source: 'plugin', pluginId: 'jira', externalId: '2' });

    const e = createTimeEntry(db, { taskId: theirs.id, startTime: todayLocalIso(9) });
    updateTimeEntry(db, e.id, { endTime: todayLocalIso(10) });
    db.instance.prepare('UPDATE tasks SET state_dirty = 1 WHERE id = ?').run(theirs.id);

    expect(getAllTasks(db, { pluginId: 'ado' }).map((t) => t.id)).toEqual([theirs.id]);
    expect(getAllTasks(db, { hasUnreportedTime: true }).map((t) => t.id)).toEqual([theirs.id]);
    expect(getAllTasks(db, { stateDirty: true }).map((t) => t.id)).toEqual([theirs.id]);
    expect(getAllTasks(db).map((t) => t.id)).toContain(mine.id);
    expect(getAllTasks(db)).toHaveLength(3);
  });
});
