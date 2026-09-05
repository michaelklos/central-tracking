import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import { DomainError } from '../errors';
import { resolveTaskId } from './taskLookup';
import { sqliteTimeToIso } from '../sqliteTime';
import { createTask, getTaskById, updateTask } from './taskHandlers';
import {
  applyAppendMarker,
  applyCreateMarker,
  collapseToTitle,
  extractTaskMarkers,
  lineBoundsForSelection,
  lineHasMarker,
} from '../../shared/journalMarkers';
import type {
  AppendSelectionToTaskInput,
  CreateJournalInput,
  CreateTaskFromSelectionInput,
  Journal,
  JournalActionResult,
  JournalListItem,
  JournalMatch,
  JournalQueryParams,
  Task,
  UpdateJournalInput,
} from '../../shared/types';

interface JournalRow {
  id: string;
  title: string;
  body: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJournal(row: JournalRow): Journal {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    deletedAt: sqliteTimeToIso(row.deleted_at),
    createdAt: sqliteTimeToIso(row.created_at),
    updatedAt: sqliteTimeToIso(row.updated_at),
  };
}

/**
 * Deliberately does not filter `deleted_at` — `restoreJournal` needs to reach
 * a deleted row, and returning the row is how the caller reads it back after
 * a write. Callers that must not act on a deleted entry use
 * `requireLiveJournalRow`.
 */
function requireJournalRow(db: Database, id: string): JournalRow {
  const row = db.instance
    .prepare('SELECT * FROM journals WHERE id = ?')
    .get(id) as JournalRow | undefined;
  if (!row) {
    throw new DomainError('NOT_FOUND', `No journal entry with id "${id}"`, 404);
  }
  return row;
}

/**
 * Resolve a user-supplied journal reference to a full id: a UUID passes
 * through, otherwise an exact id, then an id prefix, then a case-insensitive
 * title substring.
 *
 * Mirrors `resolveTaskId`, because the CLI advertises "UUID, prefix, or title
 * substring" everywhere else and a journal id copied out of `ct journal list`
 * is an 8-character prefix.
 */
export function resolveJournalId(db: Database, id: string): string {
  if (id.length >= 36) return id;

  const exact = db.instance
    .prepare('SELECT id FROM journals WHERE id = ?')
    .all(id) as { id: string }[];
  if (exact.length === 1) return exact[0].id;

  const escaped = escapeLike(id);

  const byId = db.instance
    .prepare("SELECT id FROM journals WHERE id LIKE ? ESCAPE '\\'")
    .all(`${escaped}%`) as { id: string }[];
  if (byId.length === 1) return byId[0].id;
  if (byId.length > 1) {
    throw new DomainError(
      'AMBIGUOUS_ID',
      `Ambiguous ID prefix "${id}" matches ${byId.length} journal entries. Use more characters.`,
    );
  }

  const byTitle = db.instance
    .prepare("SELECT id FROM journals WHERE title LIKE ? ESCAPE '\\' AND deleted_at IS NULL")
    .all(`%${escaped}%`) as { id: string }[];
  if (byTitle.length === 1) return byTitle[0].id;
  if (byTitle.length > 1) {
    throw new DomainError(
      'AMBIGUOUS_ID',
      `Ambiguous title "${id}" matches ${byTitle.length} journal entries. Be more specific.`,
    );
  }

  throw new DomainError('NOT_FOUND', `No journal entry with id "${id}"`, 404);
}

/** As above, but refuses an entry in the recycle bin. */
function requireLiveJournalRow(db: Database, id: string): JournalRow {
  const row = requireJournalRow(db, resolveJournalId(db, id));
  if (row.deleted_at !== null) {
    throw new DomainError('JOURNAL_DELETED', `Journal entry "${id}" is deleted`, 404);
  }
  return row;
}

// Escape `%`, `_`, and `\` so user input is matched literally by LIKE.
// Pairs with `ESCAPE '\'` in the queries below.
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Rebuild `journal_tasks` for one journal from the markers in its body.
 *
 * The body is authoritative, so this is a full replace rather than a diff:
 * deleting a marker by hand removes the index row, and a marker whose task
 * no longer exists (or whose prefix is ambiguous) is simply not indexed.
 * Unresolvable markers are left in the text untouched — the note is a record
 * of what was written, and the app does not edit prose after the fact.
 *
 * Callers must already be inside a transaction.
 */
function reindexJournal(db: Database, journalId: string, body: string): void {
  db.instance.prepare('DELETE FROM journal_tasks WHERE journal_id = ?').run(journalId);

  const prefixes = extractTaskMarkers(body);
  if (prefixes.length === 0) return;

  const findTask = db.instance.prepare(
    "SELECT id FROM tasks WHERE id LIKE ? ESCAPE '\\' LIMIT 2",
  );
  const insert = db.instance.prepare(
    'INSERT OR IGNORE INTO journal_tasks (journal_id, task_id) VALUES (?, ?)',
  );

  for (const prefix of prefixes) {
    const matches = findTask.all(`${escapeLike(prefix)}%`) as { id: string }[];
    // Exactly one match or nothing: an ambiguous prefix is not a link we can
    // assert, and guessing would attach the note to the wrong task.
    if (matches.length === 1) insert.run(journalId, matches[0].id);
  }
}

/** Body lines containing the search term, so results can show context. */
function matchingLines(body: string, search: string): JournalMatch[] {
  const needle = search.toLowerCase();
  const matches: JournalMatch[] = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      matches.push({ lineNumber: i + 1, text: lines[i] });
    }
  }
  return matches;
}

// ─── Exported handler functions (used by both IPC and HTTP server) ───

/** `params` may be null for the same reason `createJournal`'s input may be. */
export function getJournals(db: Database, params?: JournalQueryParams | null): JournalListItem[] {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (!params?.includeDeleted) clauses.push('deleted_at IS NULL');

  if (params?.search) {
    const pattern = `%${escapeLike(params.search)}%`;
    clauses.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
    values.push(pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  let sql = `SELECT * FROM journals ${where} ORDER BY created_at DESC`;
  if (params?.limit !== undefined || params?.offset !== undefined) {
    // SQLite has no bare OFFSET — `LIMIT -1` is its "all rows" sentinel, so an
    // offset with no limit still pages correctly.
    sql += ' LIMIT ?';
    values.push(params.limit ?? -1);
    if (params.offset !== undefined) {
      sql += ' OFFSET ?';
      values.push(params.offset);
    }
  }

  const rows = db.instance.prepare(sql).all(...values) as JournalRow[];
  return rows.map((row) => ({
    ...rowToJournal(row),
    // A body match with only the entry's title shown is close to useless —
    // bodies are long and one entry can match in several places.
    matches: params?.search ? matchingLines(row.body, params.search) : [],
  }));
}

export function getJournalById(db: Database, id: string): Journal | null {
  // Lenient: an unresolvable reference is "no such entry", not an error, so
  // the renderer's `getById(selectedId)` still returns null after a purge.
  let fullId: string;
  try {
    fullId = resolveJournalId(db, id);
  } catch {
    return null;
  }
  const row = db.instance
    .prepare('SELECT * FROM journals WHERE id = ?')
    .get(fullId) as JournalRow | undefined;
  return row ? rowToJournal(row) : null;
}

/** Journals whose body references this task, newest first. */
export function getJournalsByTask(db: Database, taskId: string): Journal[] {
  const fullId = resolveTaskId(db, taskId);
  const rows = db.instance
    .prepare(
      `SELECT j.* FROM journals j
       JOIN journal_tasks jt ON jt.journal_id = j.id
       WHERE jt.task_id = ? AND j.deleted_at IS NULL
       ORDER BY j.created_at DESC`,
    )
    .all(fullId) as JournalRow[];
  return rows.map(rowToJournal);
}

/**
 * `input` may be null, not just absent: an omitted argument crosses HTTP as
 * `{"args":[null]}` (JSON has no `undefined`), and a default parameter does
 * not apply to null.
 */
export function createJournal(db: Database, input?: CreateJournalInput | null): Journal {
  const id = uuidv4();
  const now = new Date().toISOString();
  const body = input?.body ?? '';

  db.instance.transaction(() => {
    db.instance
      .prepare(
        `INSERT INTO journals (id, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input?.title ?? '', body, now, now);
    // A pasted body can arrive with markers already in it.
    reindexJournal(db, id, body);
  })();

  return rowToJournal(requireJournalRow(db, id));
}

export function updateJournal(db: Database, id: string, updates: UpdateJournalInput): Journal {
  id = resolveJournalId(db, id);
  requireJournalRow(db, id);

  db.instance.transaction(() => {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      sets.push('title = ?');
      values.push(updates.title);
    }
    if (updates.body !== undefined) {
      sets.push('body = ?');
      values.push(updates.body);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      values.push(id);
      db.instance.prepare(`UPDATE journals SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    if (updates.body !== undefined) reindexJournal(db, id, updates.body);
  })();

  return rowToJournal(requireJournalRow(db, id));
}

/**
 * Soft delete. Losing a meeting's notes to a stray click is worse than losing
 * a task, so the row survives for `restoreJournal` to bring back.
 */
export function deleteJournal(db: Database, id: string): void {
  id = resolveJournalId(db, id);
  requireJournalRow(db, id);
  db.instance
    .prepare("UPDATE journals SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
    .run(id);
}

export function restoreJournal(db: Database, id: string): Journal {
  // Resolves by prefix, but not by title: a deleted entry is excluded from the
  // title lookup, and restore is the one operation that must reach one.
  id = resolveJournalId(db, id);
  requireJournalRow(db, id);
  db.instance.prepare('UPDATE journals SET deleted_at = NULL WHERE id = ?').run(id);
  return rowToJournal(requireJournalRow(db, id));
}

/**
 * Resolve a selection to the whole-line block it covers, rejecting the cases
 * where marking a line would be meaningless or would double-link it.
 */
function selectedBlock(
  row: JournalRow,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number; text: string; firstLineEnd: number } {
  const { body } = row;
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);

  if (start < 0 || end > body.length) {
    throw new DomainError(
      'INVALID_SELECTION',
      `Selection ${start}–${end} is outside the journal body (0–${body.length})`,
    );
  }

  const bounds = lineBoundsForSelection(body, start, end);
  const text = body.slice(bounds.start, bounds.end);
  if (text.trim() === '') {
    throw new DomainError('EMPTY_SELECTION', 'The selected lines contain no text');
  }

  const newlineIdx = body.indexOf('\n', bounds.start);
  const firstLineEnd = newlineIdx === -1 || newlineIdx > bounds.end ? bounds.end : newlineIdx;

  return { ...bounds, text, firstLineEnd };
}

function rewriteFirstLine(
  db: Database,
  row: JournalRow,
  block: { start: number; firstLineEnd: number },
  rewrite: (line: string) => string,
): void {
  const firstLine = row.body.slice(block.start, block.firstLineEnd);
  const body =
    row.body.slice(0, block.start) + rewrite(firstLine) + row.body.slice(block.firstLineEnd);

  db.instance
    .prepare("UPDATE journals SET body = ?, updated_at = datetime('now') WHERE id = ?")
    .run(body, row.id);
  reindexJournal(db, row.id, body);
}

/**
 * Create a task from a journal selection and mark the originating line, in one
 * transaction.
 *
 * Split across two calls this would be a real bug rather than an inconvenience:
 * a task created without its marker is exactly the duplicate-on-reread problem
 * the marker exists to prevent. Reading, rewriting and returning the body in
 * one transaction also means the selection offsets cannot shift underneath the
 * rewrite.
 *
 * The selection is expanded to whole lines and only the first line is marked —
 * one selection is one task, however many lines it spans.
 */
export function createTaskFromSelection(
  db: Database,
  input: CreateTaskFromSelectionInput,
): JournalActionResult {
  const result = db.instance.transaction((): { journalId: string; taskId: string } => {
    const row = requireLiveJournalRow(db, input.journalId);
    const block = selectedBlock(row, input.selectionStart, input.selectionEnd);

    // The whole block, not just the line that gets the marker: a selection
    // spanning an already-linked line would double-link that text and pull its
    // marker into the new task's title.
    if (lineHasMarker(block.text)) {
      throw new DomainError(
        'ALREADY_LINKED',
        'The selection already links to a task. Remove its [tsk:…] marker to create another.',
      );
    }

    const title = (input.title ?? collapseToTitle(block.text)).trim();
    if (!title) {
      throw new DomainError('EMPTY_SELECTION', 'The selection produced an empty task title');
    }

    const task = createTask(db, {
      title,
      status: input.status,
      source: input.source,
      categoryIds: input.categoryIds,
    });

    rewriteFirstLine(db, row, block, (line) => applyCreateMarker(line, task.id));

    return { journalId: row.id, taskId: task.id };
  })();

  return {
    journal: rowToJournal(requireJournalRow(db, result.journalId)),
    task: getTaskById(db, result.taskId) as Task,
  };
}

/**
 * Append a journal selection to an existing task's notes and mark the line.
 *
 * The marker is the lighter form — no checkbox, because nothing was created
 * and the line isn't done.
 */
export function appendSelectionToTask(
  db: Database,
  input: AppendSelectionToTaskInput,
): JournalActionResult {
  const result = db.instance.transaction((): { journalId: string; taskId: string } => {
    const row = requireLiveJournalRow(db, input.journalId);
    const block = selectedBlock(row, input.selectionStart, input.selectionEnd);

    const taskId = resolveTaskId(db, input.taskId);
    const task = getTaskById(db, taskId);
    if (!task) {
      throw new DomainError('NOT_FOUND', `No task with id "${input.taskId}"`, 404);
    }

    const existing = task.notes.replace(/\s+$/, '');
    const notes = existing ? `${existing}\n\n${block.text}` : block.text;
    updateTask(db, taskId, { notes });

    rewriteFirstLine(db, row, block, (line) =>
      lineHasMarker(line) ? line : applyAppendMarker(line, taskId),
    );

    return { journalId: row.id, taskId };
  })();

  return {
    journal: rowToJournal(requireJournalRow(db, result.journalId)),
    task: getTaskById(db, result.taskId) as Task,
  };
}

// ─── IPC registration (thin wrappers around exported functions) ─────

export function registerJournalHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('journals:getAll', (_event, params?: JournalQueryParams) => getJournals(db, params));
  ipcMain.handle('journals:getById', (_event, id: string) => getJournalById(db, id));
  ipcMain.handle('journals:getByTask', (_event, taskId: string) => getJournalsByTask(db, taskId));
  ipcMain.handle('journals:create', (_event, input?: CreateJournalInput) => createJournal(db, input));
  ipcMain.handle('journals:update', (_event, id: string, updates: UpdateJournalInput) => updateJournal(db, id, updates));
  ipcMain.handle('journals:delete', (_event, id: string) => deleteJournal(db, id));
  ipcMain.handle('journals:restore', (_event, id: string) => restoreJournal(db, id));
  ipcMain.handle('journals:createTaskFromSelection', (_event, input: CreateTaskFromSelectionInput) => createTaskFromSelection(db, input));
  ipcMain.handle('journals:appendSelectionToTask', (_event, input: AppendSelectionToTaskInput) => appendSelectionToTask(db, input));
}
