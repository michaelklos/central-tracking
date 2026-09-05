import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTaskContext } from '../context/TaskContext';
import { useMarkdownTextarea } from '../hooks/useMarkdownTextarea';
import { extractTaskMarkers, lineBoundsForSelection } from '../../shared/journalMarkers';
import { JournalContextMenu, type JournalMenuTarget } from './JournalContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import type { JournalActionResult, JournalListItem, Task } from '../../shared/types';
import './JournalView.css';

const SAVE_DEBOUNCE_MS = 600;
const SEARCH_DEBOUNCE_MS = 200;

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Long form for the editor header, where the date is the thing you click. */
function formatEntryDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// Same split-field shape as TimeEntryEditor, so editing a date feels the same
// wherever you do it.
function toDateValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function entryLabel(entry: JournalListItem): string {
  if (entry.title.trim()) return entry.title;
  const firstLine = entry.body.split('\n').find((l) => l.trim());
  return firstLine ? firstLine.trim().slice(0, 60) : 'Untitled';
}

/**
 * Free-form meeting notes, with the selection actions that turn them into
 * tasks. See the Journals section of CLAUDE.md for why the `[tsk:...]` marker
 * in the body — not a table — is the record of what came from where.
 */
export function JournalView() {
  const navigate = useNavigate();
  const { selectTask } = useTaskContext();
  const [entries, setEntries] = useState<JournalListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<JournalMenuTarget | null>(null);
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);
  const [undoDeleted, setUndoDeleted] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [dateEditing, setDateEditing] = useState(false);
  const [dateDraft, setDateDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Which entry the draft belongs to. Mirrored in a ref so an async load or
  // save can tell it finished for an entry the user has since navigated away
  // from, and bail before setState (CLAUDE.md, recurring footgun 3).
  const selectedIdRef = useRef<string | null>(null);
  const listGenerationRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  // The debounced save reads the draft from here rather than from a closure,
  // which would go stale between the keystroke that scheduled it and the
  // timer firing.
  const draftRef = useRef({ id: selectedId, title, body });
  draftRef.current = { id: selectedId, title, body };

  const searchRef = useRef(search);
  searchRef.current = search;

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const flushSave = useCallback(async () => {
    cancelPendingSave();
    if (!dirtyRef.current) return;
    const draft = draftRef.current;
    if (!draft.id) return;
    dirtyRef.current = false;
    setSaving(true);
    try {
      await window.api.journals.update(draft.id, { title: draft.title, body: draft.body });
    } catch (err) {
      dirtyRef.current = true;
      window.api.log.error(`JournalView.save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [cancelPendingSave]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    cancelPendingSave();
    saveTimerRef.current = window.setTimeout(() => {
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [cancelPendingSave, flushSave]);

  const loadList = useCallback(async (term: string) => {
    const generation = ++listGenerationRef.current;
    const res = await window.api.journals.getAll(term.trim() ? { search: term.trim() } : undefined);
    if (listGenerationRef.current !== generation) return;
    setEntries(res);
  }, []);

  const openEntry = useCallback(
    async (id: string) => {
      // Flush first: switching entries must not strand the previous draft.
      await flushSave();
      selectedIdRef.current = id;
      setSelectedId(id);
      const entry = await window.api.journals.getById(id);
      if (selectedIdRef.current !== id) return;
      setTitle(entry?.title ?? '');
      setBody(entry?.body ?? '');
      setCreatedAt(entry?.createdAt ?? null);
      setDateEditing(false);
      dirtyRef.current = false;
    },
    [flushSave],
  );

  // Initial load + search. Debounced so typing doesn't hit the DB per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadList(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, loadList]);

  // Any mutation elsewhere (CLI, another pane) refreshes the list, and the
  // open entry is re-read so the server stays authoritative. The re-read is
  // skipped while the draft is dirty — otherwise a refresh would throw away
  // what the user is mid-way through typing.
  //
  // The search term is read from a ref rather than closed over, so this
  // subscribes once instead of tearing down and re-registering the listener
  // on every keystroke in the search box.
  useEffect(() => {
    const unsubscribe = window.api.onDataChanged(() => {
      void loadList(searchRef.current);
      const id = selectedIdRef.current;
      if (!id || dirtyRef.current) return;
      void (async () => {
        const entry = await window.api.journals.getById(id);
        if (selectedIdRef.current !== id || dirtyRef.current) return;
        setTitle(entry?.title ?? '');
        setBody(entry?.body ?? '');
        setCreatedAt(entry?.createdAt ?? null);
      })();
    });
    return unsubscribe;
  }, [loadList]);

  // Deep link from a task's "from this note" link. Routed through `openEntry`
  // so the flush-before-switch and staleness guards apply, and keyed on the
  // param so it fires once per link rather than on every render. A dirty draft
  // wins: arriving here mid-edit must not discard what is being typed.
  const entryParam = searchParams.get('entry');
  useEffect(() => {
    if (!entryParam || entryParam === selectedIdRef.current || dirtyRef.current) return;
    void openEntry(entryParam);
  }, [entryParam, openEntry]);

  // Save whatever is pending when the pane goes away.
  useEffect(() => () => { void flushSave(); }, [flushSave]);

  // Resolve the markers in the body to real tasks. `getById` accepts an id
  // prefix, so the 8 characters in the marker are enough; a marker whose task
  // was purged simply resolves to nothing and is left in the text.
  useEffect(() => {
    const prefixes = extractTaskMarkers(body);
    if (prefixes.length === 0) {
      setLinkedTasks([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const resolved = await Promise.all(prefixes.map((p) => window.api.tasks.getById(p)));
      if (cancelled) return;
      setLinkedTasks(resolved.filter((t): t is Task => t !== null));
    })();
    return () => { cancelled = true; };
  }, [body]);

  const handleNew = useCallback(async () => {
    await flushSave();
    const created = await window.api.journals.create({ title: '', body: '' });
    // Claim the new entry before awaiting anything else: the create fires
    // `ct:data-changed`, and a refresh landing while the ref still points at
    // the previous entry would re-read that one over the blank draft.
    selectedIdRef.current = created.id;
    setSelectedId(created.id);
    setTitle('');
    setBody('');
    setCreatedAt(created.createdAt);
    dirtyRef.current = false;
    await loadList(search);
  }, [flushSave, loadList, search]);

  const handleSaveDate = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return;
    const parsed = new Date(`${dateDraft}T${timeDraft || '00:00'}:00`);
    if (Number.isNaN(parsed.getTime())) {
      setDateError('Not a valid date');
      return;
    }
    // Flush first: the date write is a separate update, and a pending body
    // save would otherwise land after it with a stale draft.
    await flushSave();
    const updated = await window.api.journals.update(id, { createdAt: parsed.toISOString() });
    if (selectedIdRef.current !== id) return;
    setCreatedAt(updated.createdAt);
    setDateEditing(false);
    setDateError(null);
    // Moving the date re-files the note, so the list order changes.
    await loadList(search);
  }, [dateDraft, timeDraft, flushSave, loadList, search]);

  const handleDelete = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return;
    cancelPendingSave();
    dirtyRef.current = false;
    await window.api.journals.delete(id);
    selectedIdRef.current = null;
    setSelectedId(null);
    setTitle('');
    setBody('');
    // Soft delete, so an undo is one call away — losing a meeting's notes to a
    // stray click is worse than losing a task.
    setUndoDeleted(id);
    setConfirmDelete(false);
    await loadList(search);
  }, [cancelPendingSave, loadList, search]);

  const handleUndoDelete = useCallback(async () => {
    if (!undoDeleted) return;
    await window.api.journals.restore(undoDeleted);
    const id = undoDeleted;
    setUndoDeleted(null);
    await loadList(search);
    await openEntry(id);
  }, [undoDeleted, loadList, search, openEntry]);

  /**
   * Snapshot the selection at right-click time, and flush the draft first.
   *
   * Both halves matter. Reading `selectionStart` when the menu item is clicked
   * gives a collapsed selection, because focus has moved to the menu. And the
   * offsets index into what the user sees, so the server has to be holding the
   * same text — an unsaved keystroke above the selection would shift every
   * offset below it.
   */
  const handleContextMenu = useCallback(
    async (e: React.MouseEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      const textarea = e.currentTarget;
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      // Everything off the event must be read before the await — `currentTarget`
      // is cleared once React returns from the handler.
      const { clientX, clientY } = e;

      // With nothing selected, act on the line under the caret. The server
      // expands any range to whole lines anyway, so a collapsed caret is a
      // valid selection — and right-clicking a bullet to turn it into a to-do
      // is the obvious gesture.
      const bounds = lineBoundsForSelection(
        draftRef.current.body,
        selectionStart,
        selectionEnd,
      );
      const preview = draftRef.current.body.slice(bounds.start, bounds.end);
      if (preview.trim() === '') return;

      await flushSave();
      if (selectedIdRef.current === null) return;
      setMenu({ x: clientX, y: clientY, selectionStart, selectionEnd, preview });
    },
    [flushSave],
  );

  const handleApplied = useCallback(
    (result: JournalActionResult) => {
      // The server rewrote the body. Drop any pending save — it holds the
      // pre-marker draft and would overwrite the marker that was just written.
      //
      // Setting the draft here is only to avoid a flash of the pre-marker
      // text: the mutation also fires `ct:data-changed`, and that refresh
      // re-reads the entry. The server stays authoritative either way.
      cancelPendingSave();
      dirtyRef.current = false;
      if (selectedIdRef.current === result.journal.id) {
        setTitle(result.journal.title);
        setBody(result.journal.body);
        setCreatedAt(result.journal.createdAt);
      }
      void loadList(search);
    },
    [cancelPendingSave, loadList, search],
  );

  const md = useMarkdownTextarea({
    value: body,
    onChange: (next) => { setBody(next); scheduleSave(); },
    onSave: () => { void flushSave(); },
  });

  return (
    <div className="journal-view">
      <div className="journal-view__list">
        <div className="journal-view__list-header">
          <input
            className="journal-view__search"
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="journal-view__new" onClick={() => void handleNew()} title="New entry">
            +
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="journal-view__empty">
            {search.trim() ? 'No notes match.' : 'No notes yet.'}
          </div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              className={`journal-view__entry ${entry.id === selectedId ? 'journal-view__entry--active' : ''}`}
              onClick={() => {
                // Drop a stale ?entry= or the deep-link effect would pull the
                // user back to the linked note.
                if (entryParam) setSearchParams({}, { replace: true });
                void openEntry(entry.id);
              }}
            >
              <div className="journal-view__entry-row">
                <span className="journal-view__entry-title">{entryLabel(entry)}</span>
                <span className="journal-view__entry-date">{formatEntryDate(entry.createdAt)}</span>
              </div>
              {/* Showing only the title for a body match is close to useless —
                  bodies are long and one entry can match in several places. */}
              {entry.matches.slice(0, 3).map((match) => (
                <div key={match.lineNumber} className="journal-view__entry-match">
                  <span className="journal-view__entry-line">{match.lineNumber}</span>
                  {match.text.trim()}
                </div>
              ))}
            </button>
          ))
        )}
      </div>

      <div className="journal-view__editor">
        {selectedId === null ? (
          <div className="journal-view__placeholder">
            Select a note, or start a new one.
          </div>
        ) : (
          <>
            <div className="journal-view__editor-header">
              <input
                className="journal-view__title"
                type="text"
                placeholder="Untitled"
                value={title}
                onChange={(e) => { setTitle(e.target.value); scheduleSave(); }}
                onBlur={() => void flushSave()}
              />
              {createdAt !== null && (
                dateEditing ? (
                  <span className="journal-view__date-edit">
                    <input
                      type="date"
                      value={dateDraft}
                      onChange={(e) => setDateDraft(e.target.value)}
                      autoFocus
                    />
                    <input
                      type="time"
                      value={timeDraft}
                      onChange={(e) => setTimeDraft(e.target.value)}
                    />
                    <button onClick={() => void handleSaveDate()}>Save</button>
                    <button onClick={() => { setDateEditing(false); setDateError(null); }}>Cancel</button>
                    {dateError && <span className="journal-view__date-error" role="alert">{dateError}</span>}
                  </span>
                ) : (
                  <button
                    className="journal-view__date"
                    title="Change when this note was taken"
                    onClick={() => {
                      setDateDraft(toDateValue(createdAt));
                      setTimeDraft(toTimeValue(createdAt));
                      setDateError(null);
                      setDateEditing(true);
                    }}
                  >
                    {formatEntryDateTime(createdAt)}
                  </button>
                )
              )}
              <span className="journal-view__status">{saving ? 'Saving…' : ''}</span>
              <button
                className="journal-view__delete"
                onClick={() => setConfirmDelete(true)}
                title="Delete entry"
              >
                Delete
              </button>
            </div>

            <textarea
              className="journal-view__body"
              value={body}
              placeholder="Type your notes. Select text and right-click to turn it into a to-do."
              onChange={(e) => { setBody(e.target.value); scheduleSave(); }}
              onKeyDown={md.onKeyDown}
              onBlur={() => void flushSave()}
              onContextMenu={(e) => void handleContextMenu(e)}
              spellCheck
            />

            {linkedTasks.length > 0 && (
              <div className="journal-view__linked">
                <div className="journal-view__linked-label">Tasks from this note</div>
                {linkedTasks.map((task) => (
                  <button
                    key={task.id}
                    className="journal-view__linked-task"
                    title="Open this task"
                    onClick={() => { selectTask(task.id); navigate('/'); }}
                  >
                    <span className="journal-view__linked-marker">{task.id.slice(0, 8)}</span>
                    {task.title}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {undoDeleted && (
        <div className="journal-view__undo" role="status">
          Note deleted.
          <button className="journal-view__undo-action" onClick={() => void handleUndoDelete()}>
            Undo
          </button>
          <button className="journal-view__undo-dismiss" onClick={() => setUndoDeleted(null)}>
            ✕
          </button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete note"
          message={`Move "${title.trim() || 'this untitled note'}" to the recycle bin? Undo is offered afterwards, and "ct journal restore" brings it back later.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {menu && selectedId && (
        <JournalContextMenu
          journalId={selectedId}
          target={menu}
          onClose={() => setMenu(null)}
          onApplied={handleApplied}
          onGoToTask={(taskId) => { selectTask(taskId); navigate('/'); }}
        />
      )}
    </div>
  );
}
