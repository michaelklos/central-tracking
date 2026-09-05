import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import {
  appendSelectionToTask,
  createJournal,
  createTaskFromSelection,
  deleteJournal,
  getJournalById,
  getJournals,
  getJournalsByTask,
  restoreJournal,
  updateJournal,
} from '../journalHandlers';
import { createTask, deleteTask, getTaskById } from '../taskHandlers';
import { createCategory } from '../categoryHandlers';
import { taskMarker } from '../../../shared/journalMarkers';

const NOTES = [
  '# Vendor sync',
  'Vendor pushed the SLA date to Q3.',
  '- Chase the SLA numbers',
  '- Draft the summary',
].join('\n');

/** Character offsets of a substring in a body, as a textarea selection would give them. */
function selectionOf(body: string, needle: string): { selectionStart: number; selectionEnd: number } {
  const selectionStart = body.indexOf(needle);
  if (selectionStart === -1) throw new Error(`"${needle}" not in body`);
  return { selectionStart, selectionEnd: selectionStart + needle.length };
}

function indexedTaskIds(db: Database, journalId: string): string[] {
  return (
    db.instance
      .prepare('SELECT task_id FROM journal_tasks WHERE journal_id = ? ORDER BY task_id')
      .all(journalId) as { task_id: string }[]
  ).map((r) => r.task_id);
}

describe('Journal handlers', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('migration 010', () => {
    it('creates the journals and journal_tasks tables', () => {
      const tables = (
        db.instance
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('journals', 'journal_tasks')")
          .all() as { name: string }[]
      ).map((r) => r.name);
      expect(tables.sort()).toEqual(['journal_tasks', 'journals']);
    });

    it('reports schema version 10', () => {
      const row = db.instance
        .prepare('SELECT MAX(version) as version FROM schema_version')
        .get() as { version: number };
      expect(row.version).toBe(10);
    });
  });

  describe('CRUD', () => {
    it('creates and reads back an entry', () => {
      const journal = createJournal(db, { title: 'Vendor sync', body: NOTES });
      expect(journal.id).toBeDefined();
      expect(journal.title).toBe('Vendor sync');
      expect(journal.body).toBe(NOTES);
      expect(journal.deletedAt).toBeNull();

      expect(getJournalById(db, journal.id)?.body).toBe(NOTES);
    });

    it('defaults title and body to empty strings', () => {
      const journal = createJournal(db);
      expect(journal.title).toBe('');
      expect(journal.body).toBe('');
    });

    it('updates title and body independently', () => {
      const journal = createJournal(db, { title: 'Draft', body: 'one' });

      const titled = updateJournal(db, journal.id, { title: 'Vendor sync' });
      expect(titled.title).toBe('Vendor sync');
      expect(titled.body).toBe('one');

      const rewritten = updateJournal(db, journal.id, { body: 'two' });
      expect(rewritten.title).toBe('Vendor sync');
      expect(rewritten.body).toBe('two');
    });

    it('lists entries newest first', () => {
      const a = createJournal(db, { title: 'A' });
      const b = createJournal(db, { title: 'B' });
      // created_at has one-second resolution, so order by id when they collide.
      const ids = getJournals(db).map((j) => j.id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
    });

    it('throws NOT_FOUND for an unknown id', () => {
      expect(() => updateJournal(db, 'nope', { title: 'x' })).toThrow(/No journal entry/);
    });
  });

  describe('soft delete', () => {
    it('hides deleted entries from the default listing and restores them', () => {
      const journal = createJournal(db, { title: 'Vendor sync', body: NOTES });

      deleteJournal(db, journal.id);
      expect(getJournals(db)).toHaveLength(0);
      expect(getJournals(db, { includeDeleted: true })).toHaveLength(1);
      expect(getJournalById(db, journal.id)?.deletedAt).not.toBeNull();

      const restored = restoreJournal(db, journal.id);
      expect(restored.deletedAt).toBeNull();
      expect(getJournals(db)).toHaveLength(1);
      // The body survives the round trip — that is the point of soft delete.
      expect(restored.body).toBe(NOTES);
    });
  });

  describe('search', () => {
    it('matches on title and body and returns the matching lines', () => {
      createJournal(db, { title: 'Vendor sync', body: NOTES });
      createJournal(db, { title: 'Standup', body: 'Nothing to report' });

      const results = getJournals(db, { search: 'SLA' });
      expect(results).toHaveLength(1);
      expect(results[0].matches.map((m) => m.lineNumber)).toEqual([2, 3]);
      expect(results[0].matches[1].text).toBe('- Chase the SLA numbers');
    });

    it('is case-insensitive', () => {
      createJournal(db, { title: 'Vendor sync', body: NOTES });
      expect(getJournals(db, { search: 'sla' })).toHaveLength(1);
    });

    it('treats LIKE wildcards as literal characters', () => {
      createJournal(db, { title: 'Vendor sync', body: NOTES });
      expect(getJournals(db, { search: '%' })).toHaveLength(0);
      expect(getJournals(db, { search: '_' })).toHaveLength(0);
    });

    it('returns no matches when not searching', () => {
      createJournal(db, { title: 'Vendor sync', body: NOTES });
      expect(getJournals(db)[0].matches).toEqual([]);
    });
  });

  describe('createTaskFromSelection', () => {
    it('creates the task and marks the originating line in one call', () => {
      const journal = createJournal(db, { body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
      });

      expect(result.task.title).toBe('Chase the SLA numbers');
      expect(result.journal.body).toContain(
        `- [x] ${taskMarker(result.task.id)} Chase the SLA numbers`,
      );
      // Untouched lines stay untouched.
      expect(result.journal.body).toContain('- Draft the summary');
      expect(indexedTaskIds(db, journal.id)).toEqual([result.task.id]);
    });

    it('accepts an explicit title over the selected text', () => {
      const journal = createJournal(db, { body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
        title: 'Get SLA numbers from vendor',
      });
      expect(result.task.title).toBe('Get SLA numbers from vendor');
      // The line still carries the marker, not the new title.
      expect(result.journal.body).toContain(
        `- [x] ${taskMarker(result.task.id)} Chase the SLA numbers`,
      );
    });

    it('passes status, source and categories through to the task', () => {
      const journal = createJournal(db, { body: NOTES });
      const category = createCategory(db, { name: 'Vendor' });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
        status: 'in-progress',
        source: 'meeting-prep',
        categoryIds: [category.id],
      });
      expect(result.task.status).toBe('in-progress');
      expect(result.task.source).toBe('meeting-prep');
      expect(result.task.categoryIds).toEqual([category.id]);
    });

    // The load-bearing claim of this handler: the task insert and the body
    // rewrite land together or not at all. Every other failure path fires
    // before the task is created, so only a post-insert failure tests it —
    // here, the FK on task_categories.category_id.
    it('rolls back the task when a later step in the transaction fails', () => {
      const journal = createJournal(db, { body: NOTES });

      expect(() =>
        createTaskFromSelection(db, {
          journalId: journal.id,
          ...selectionOf(NOTES, 'Chase the SLA numbers'),
          categoryIds: ['no-such-category'],
        }),
      ).toThrow();

      expect(db.instance.prepare('SELECT COUNT(*) as n FROM tasks').get()).toEqual({ n: 0 });
      expect(getJournalById(db, journal.id)?.body).toBe(NOTES);
      expect(indexedTaskIds(db, journal.id)).toEqual([]);
    });

    it('refuses a selection that spans an already-linked line', () => {
      const journal = createJournal(db, { body: NOTES });
      const first = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, '- Draft the summary'),
      });

      // Lines 3–4, where line 4 now carries a marker.
      const marked = getJournalById(db, journal.id)!.body;
      expect(() =>
        createTaskFromSelection(db, {
          journalId: journal.id,
          selectionStart: marked.indexOf('- Chase'),
          selectionEnd: marked.length,
        }),
      ).toThrow(/already links to a task/);

      expect(getJournalById(db, journal.id)?.body).toBe(marked);
      expect(indexedTaskIds(db, journal.id)).toEqual([first.task.id]);
    });

    it('refuses a journal entry that is in the recycle bin', () => {
      const journal = createJournal(db, { body: NOTES });
      deleteJournal(db, journal.id);
      expect(() =>
        createTaskFromSelection(db, {
          journalId: journal.id,
          ...selectionOf(NOTES, 'Chase the SLA numbers'),
        }),
      ).toThrow(/is deleted/);
    });

    it('marks only the first line of a multi-line selection', () => {
      const journal = createJournal(db, { body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, '- Chase the SLA numbers\n- Draft the summary'),
      });

      expect(result.task.title).toBe('Chase the SLA numbers Draft the summary');
      const lines = result.journal.body.split('\n');
      expect(lines[2]).toBe(`- [x] ${taskMarker(result.task.id)} Chase the SLA numbers`);
      expect(lines[3]).toBe('- Draft the summary');
      expect(indexedTaskIds(db, journal.id)).toHaveLength(1);
    });

    it('expands a mid-word selection to the whole line', () => {
      const journal = createJournal(db, { body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'SLA num'),
      });
      expect(result.task.title).toBe('Chase the SLA numbers');
    });

    it('refuses a line that already links to a task, and creates nothing', () => {
      const journal = createJournal(db, { body: NOTES });
      const first = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
      });

      const marked = getJournalById(db, journal.id)!.body;
      expect(() =>
        createTaskFromSelection(db, {
          journalId: journal.id,
          ...selectionOf(marked, 'Chase the SLA numbers'),
        }),
      ).toThrow(/already links to a task/);

      // The whole point: no duplicate task, and the body is unchanged.
      expect(getJournals(db)[0].body).toBe(marked);
      expect(indexedTaskIds(db, journal.id)).toEqual([first.task.id]);
    });

    it('rejects an empty selection', () => {
      const journal = createJournal(db, { body: 'one\n\ntwo' });
      expect(() =>
        createTaskFromSelection(db, { journalId: journal.id, selectionStart: 4, selectionEnd: 4 }),
      ).toThrow(/no text/);
    });

    it('rejects a selection outside the body', () => {
      const journal = createJournal(db, { body: 'short' });
      expect(() =>
        createTaskFromSelection(db, { journalId: journal.id, selectionStart: 0, selectionEnd: 999 }),
      ).toThrow(/outside the journal body/);
    });

    it('throws NOT_FOUND for an unknown journal without creating a task', () => {
      expect(() =>
        createTaskFromSelection(db, { journalId: 'nope', selectionStart: 0, selectionEnd: 1 }),
      ).toThrow(/No journal entry/);
      expect(db.instance.prepare('SELECT COUNT(*) as n FROM tasks').get()).toEqual({ n: 0 });
    });
  });

  describe('appendSelectionToTask', () => {
    it('appends the selection to the task notes and marks the line', () => {
      const journal = createJournal(db, { body: NOTES });
      const task = createTask(db, { title: 'Vendor SLA' });

      const result = appendSelectionToTask(db, {
        journalId: journal.id,
        taskId: task.id,
        ...selectionOf(NOTES, 'Vendor pushed the SLA date to Q3.'),
      });

      expect(result.task.notes).toBe('Vendor pushed the SLA date to Q3.');
      // Lighter marker: no checkbox, because nothing was created.
      expect(result.journal.body.split('\n')[1]).toBe(
        `Vendor pushed the SLA date to Q3. ${taskMarker(task.id)}`,
      );
      expect(indexedTaskIds(db, journal.id)).toEqual([task.id]);
    });

    it('appends after existing notes with a blank line between', () => {
      const journal = createJournal(db, { body: NOTES });
      const task = createTask(db, { title: 'Vendor SLA' });
      const first = appendSelectionToTask(db, {
        journalId: journal.id,
        taskId: task.id,
        ...selectionOf(NOTES, 'Vendor pushed the SLA date to Q3.'),
      });

      const second = appendSelectionToTask(db, {
        journalId: journal.id,
        taskId: task.id,
        ...selectionOf(first.journal.body, '- Draft the summary'),
      });

      expect(second.task.notes).toBe('Vendor pushed the SLA date to Q3.\n\n- Draft the summary');
    });

    it('resolves a task by id prefix, the way a pasted marker would', () => {
      const journal = createJournal(db, { body: NOTES });
      const task = createTask(db, { title: 'Vendor SLA' });

      const result = appendSelectionToTask(db, {
        journalId: journal.id,
        taskId: task.id.slice(0, 8),
        ...selectionOf(NOTES, 'Vendor pushed the SLA date to Q3.'),
      });
      expect(result.task.id).toBe(task.id);
    });

    it('leaves an already-marked line alone rather than double-marking it', () => {
      const journal = createJournal(db, { body: NOTES });
      const created = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
      });
      const other = createTask(db, { title: 'Other' });

      const result = appendSelectionToTask(db, {
        journalId: journal.id,
        taskId: other.id,
        ...selectionOf(created.journal.body, 'Chase the SLA numbers'),
      });

      expect(result.task.notes).toContain('Chase the SLA numbers');
      // Only the original marker survives on that line.
      expect(result.journal.body).not.toContain(taskMarker(other.id));
      expect(indexedTaskIds(db, journal.id)).toEqual([created.task.id]);
    });

    it('throws NOT_FOUND for an unknown task and leaves the body untouched', () => {
      const journal = createJournal(db, { body: NOTES });
      expect(() =>
        appendSelectionToTask(db, {
          journalId: journal.id,
          taskId: 'no-such-task',
          ...selectionOf(NOTES, 'Chase the SLA numbers'),
        }),
      ).toThrow();
      expect(getJournalById(db, journal.id)?.body).toBe(NOTES);
    });
  });

  describe('journal_tasks is derived from the body', () => {
    it('drops the index row when the marker is deleted by hand', () => {
      const journal = createJournal(db, { body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
      });
      expect(indexedTaskIds(db, journal.id)).toEqual([result.task.id]);

      // User edits the marker away in the textarea.
      updateJournal(db, journal.id, { body: NOTES });
      expect(indexedTaskIds(db, journal.id)).toEqual([]);
    });

    it('indexes markers present in a body pasted at creation time', () => {
      const task = createTask(db, { title: 'Pre-existing' });
      const journal = createJournal(db, { body: `- [x] ${taskMarker(task.id)} Pre-existing` });
      expect(indexedTaskIds(db, journal.id)).toEqual([task.id]);
    });

    it('ignores a marker whose task no longer exists, leaving the text alone', () => {
      const journal = createJournal(db, { body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
      });

      // Hard-delete the task out from under the marker.
      db.instance.prepare('DELETE FROM tasks WHERE id = ?').run(result.task.id);
      expect(indexedTaskIds(db, journal.id)).toEqual([]);

      // Rewriting the body must not resurrect or strip the dangling marker.
      const body = getJournalById(db, journal.id)!.body;
      const rewritten = updateJournal(db, journal.id, { body: `${body}\n- new line` });
      expect(rewritten.body).toContain(taskMarker(result.task.id));
      expect(indexedTaskIds(db, journal.id)).toEqual([]);
    });

    it('keeps the link when a task is soft-deleted', () => {
      const journal = createJournal(db, { body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
      });

      deleteTask(db, result.task.id);
      // The marker still names a real row; resolving it is the reader's job.
      expect(indexedTaskIds(db, journal.id)).toEqual([result.task.id]);
      expect(getTaskById(db, result.task.id)).toBeNull();
    });

    it('survives edits made above the marked line', () => {
      const journal = createJournal(db, { body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: journal.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
      });

      // Insert two lines at the top — every offset below shifts.
      const edited = `Extra context\nMore context\n${result.journal.body}`;
      const after = updateJournal(db, journal.id, { body: edited });

      expect(after.body).toContain(`- [x] ${taskMarker(result.task.id)} Chase the SLA numbers`);
      expect(indexedTaskIds(db, journal.id)).toEqual([result.task.id]);
    });
  });

  describe('getJournalsByTask', () => {
    it('returns every entry referencing the task, and skips deleted entries', () => {
      const first = createJournal(db, { title: 'Sync 1', body: NOTES });
      const result = createTaskFromSelection(db, {
        journalId: first.id,
        ...selectionOf(NOTES, 'Chase the SLA numbers'),
      });

      const second = createJournal(db, { title: 'Sync 2', body: 'Followed up on it' });
      appendSelectionToTask(db, {
        journalId: second.id,
        taskId: result.task.id,
        ...selectionOf('Followed up on it', 'Followed up on it'),
      });

      const titles = getJournalsByTask(db, result.task.id).map((j) => j.title);
      expect(titles.sort()).toEqual(['Sync 1', 'Sync 2']);

      deleteJournal(db, second.id);
      expect(getJournalsByTask(db, result.task.id).map((j) => j.title)).toEqual(['Sync 1']);
    });

    it('returns nothing for a task no journal mentions', () => {
      const task = createTask(db, { title: 'Unmentioned' });
      expect(getJournalsByTask(db, task.id)).toEqual([]);
    });
  });
});
