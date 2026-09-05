import React, { useEffect, useMemo, useRef, useState } from 'react';
import { extractTaskMarkers } from '../../shared/journalMarkers';
import type { JournalActionResult, Task } from '../../shared/types';
import './JournalContextMenu.css';

const PICKER_LIMIT = 8;

/**
 * What the user had selected when they right-clicked.
 *
 * The offsets are snapshotted at right-click time on purpose. By the time a
 * menu item is clicked, focus has left the textarea and
 * `selectionStart`/`selectionEnd` may have collapsed — reading them then is
 * how you create a task from nothing.
 */
export interface JournalMenuTarget {
  x: number;
  y: number;
  selectionStart: number;
  selectionEnd: number;
  /** The selected text, for labelling the menu only. */
  preview: string;
}

interface Props {
  journalId: string;
  target: JournalMenuTarget;
  onClose(): void;
  /** Applies the returned journal + task to the pane (draft, list, refresh). */
  onApplied(result: JournalActionResult): void;
  /** Opens a task the selected line already links to. */
  onGoToTask(taskId: string): void;
}

function truncate(text: string, max = 40): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * Strip Electron's IPC wrapper off a rejected `invoke`, which arrives as
 * "Error invoking remote method 'journals:x': DomainError: <the actual thing>".
 * Only the tail is meant for a person.
 */
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const unwrapped = raw.replace(/^Error invoking remote method '[^']*':\s*/, '');
  return unwrapped.replace(/^[A-Za-z]*Error:\s*/, '');
}

/**
 * Right-click menu over the journal editor. Chrome (positioning, dismissal,
 * errors pinned on the menu) follows `TaskContextMenu`; the difference is the
 * picker mode, which replaces the action list rather than opening a nested
 * dialog — a second popover would fight this one's outside-click handler.
 */
export function JournalContextMenu({ journalId, target, onClose, onApplied, onGoToTask }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'actions' | 'picker'>('actions');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the menu on screen when the click lands near an edge.
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(target.x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(target.y, window.innerHeight - height - 4)),
    });
  }, [target.x, target.y, mode]);

  useEffect(() => {
    if (mode === 'picker') searchRef.current?.focus();
  }, [mode]);

  // Failures stay on the menu. Closing would leave the user with a selection
  // that silently did nothing.
  const run = async (what: string, fn: () => Promise<JournalActionResult>) => {
    if (busy) return;
    setBusy(true);
    try {
      setError(null);
      onApplied(await fn());
      onClose();
    } catch (err) {
      setError(`${what}: ${readableError(err)}`);
      window.api.log.error(
        `JournalContextMenu.${what}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const selection = { selectionStart: target.selectionStart, selectionEnd: target.selectionEnd };

  // A line that already carries a marker can't produce another task, so the
  // menu offers to open the one it names instead of making the user click
  // "Create to-do" to be told no.
  const markers = useMemo(() => extractTaskMarkers(target.preview), [target.preview]);
  const [linked, setLinked] = useState<Task[]>([]);
  useEffect(() => {
    if (markers.length === 0) {
      setLinked([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      // The 8-char prefix is enough — `getById` resolves prefixes.
      const resolved = await Promise.all(markers.map((m) => window.api.tasks.getById(m)));
      if (cancelled) return;
      setLinked(resolved.filter((t): t is Task => t !== null));
    })();
    return () => { cancelled = true; };
  }, [markers]);

  // Queried rather than filtered from TaskContext, whose `tasks` holds only
  // the pages already loaded — the task you want to append to is often one
  // the list hasn't scrolled to.
  const [matches, setMatches] = useState<Task[]>([]);
  const searchGenerationRef = useRef(0);
  useEffect(() => {
    if (mode !== 'picker') return;
    const generation = ++searchGenerationRef.current;
    const timer = setTimeout(async () => {
      const res = await window.api.tasks.getActive({
        search: search.trim() || undefined,
        searchIn: 'title',
        limit: PICKER_LIMIT,
        offset: 0,
      });
      // A slower response for an earlier query must not replace a newer one.
      if (searchGenerationRef.current !== generation) return;
      setMatches(res.items);
    }, 150);
    return () => clearTimeout(timer);
  }, [mode, search]);

  return (
    <div
      className="journal-context-menu"
      role="menu"
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="journal-context-menu__label" title={target.preview}>
        “{truncate(target.preview)}”
      </div>

      {mode === 'actions' ? (
        <>
          {linked.map((task) => (
            <button
              key={task.id}
              role="menuitem"
              className="journal-context-menu__item"
              title={task.title}
              onClick={() => { onGoToTask(task.id); onClose(); }}
            >
              Go to “{truncate(task.title, 28)}”
            </button>
          ))}
          <button
            role="menuitem"
            className="journal-context-menu__item"
            disabled={busy || markers.length > 0}
            onClick={() =>
              run('Failed to create to-do', () =>
                window.api.journals.createTaskFromSelection({ journalId, ...selection }),
              )
            }
          >
            Create to-do
          </button>
          {/* Not a `title` tooltip: a disabled button fires no mouse events,
              so the browser never shows one. The reason has to be visible. */}
          {markers.length > 0 && (
            <div className="journal-context-menu__hint">Already linked to a task</div>
          )}
          <button
            role="menuitem"
            className="journal-context-menu__item"
            disabled={busy}
            onClick={() => setMode('picker')}
          >
            Append to task notes…
          </button>
        </>
      ) : (
        <>
          <input
            ref={searchRef}
            className="journal-context-menu__search"
            type="text"
            placeholder="Find a task…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {matches.length === 0 ? (
            <div className="journal-context-menu__empty">No matching task</div>
          ) : (
            matches.map((task) => (
              <button
                key={task.id}
                role="menuitem"
                className="journal-context-menu__item"
                disabled={busy}
                title={task.title}
                onClick={() =>
                  run('Failed to append', () =>
                    window.api.journals.appendSelectionToTask({
                      journalId,
                      taskId: task.id,
                      ...selection,
                    }),
                  )
                }
              >
                {truncate(task.title, 34)}
              </button>
            ))
          )}
        </>
      )}

      {error && <div className="journal-context-menu__error" role="alert">{error}</div>}
    </div>
  );
}
