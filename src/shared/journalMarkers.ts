/**
 * Journal → task markers.
 *
 * When a task is created from a journal selection, the originating line is
 * rewritten to carry `[tsk:xxxxxxxx]` — the first 8 hex characters of the
 * task's UUID. That marker in the body is the source of truth for the link:
 * it is the only thing that knows *which line* a task came from, and it moves
 * with the text when the note is edited above it. `journal_tasks` is an index
 * rebuilt from these markers on every write, never the other way around.
 *
 * The 8-character prefix is deliberate. `resolveTaskId` already resolves id
 * prefixes (with a proper `AMBIGUOUS_ID` error), so a marker copied straight
 * out of a note works verbatim in `ct task show a1b2c3d4`.
 *
 * Only the `[tsk:...]` token is a marker. The `- [x] ` checkbox the create
 * action also writes is cosmetic — a line the user ticked by hand carries no
 * marker and is correctly read as "not linked to anything".
 *
 * Shared with the renderer, which needs the same regex to render markers.
 */

/** Number of leading UUID characters stored in a marker. */
export const MARKER_ID_LENGTH = 8;

/** Matches every marker in a body. Global — use with `matchAll`, not `test`. */
export const TASK_MARKER_RE = /\[tsk:([0-9a-f]{8})\]/g;

/** The marker token for a task id. */
export function taskMarker(taskId: string): string {
  return `[tsk:${taskId.slice(0, MARKER_ID_LENGTH)}]`;
}

/** Every distinct task-id prefix referenced by a body, in first-seen order. */
export function extractTaskMarkers(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(TASK_MARKER_RE)) {
    seen.add(match[1]);
  }
  return [...seen];
}

/** True if this single line already carries a marker. */
export function lineHasMarker(line: string): boolean {
  return extractTaskMarkers(line).length > 0;
}

/**
 * Expand a character selection to whole-line bounds. A selection that starts
 * mid-word still marks the line it lands on, and `selectionEnd` sitting at a
 * line start (a trailing newline in the drag) does not pull in the next line.
 */
export function lineBoundsForSelection(
  body: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } {
  const lineStartIdx = body.lastIndexOf('\n', selectionStart - 1);
  const start = lineStartIdx === -1 ? 0 : lineStartIdx + 1;

  // Back off a selection that ends exactly on a line boundary, so a drag that
  // overshoots into the next line's start doesn't swallow that line.
  const effectiveEnd = selectionEnd > start && body[selectionEnd - 1] === '\n'
    ? selectionEnd - 1
    : selectionEnd;
  const lineEndIdx = body.indexOf('\n', effectiveEnd);
  const end = lineEndIdx === -1 ? body.length : lineEndIdx;

  return { start, end };
}

const LINE_PREFIX_RE = /^(\s*)(?:[-*+]\s+|\d+\.\s+)?(.*)$/;

/**
 * Rewrite a line as a completed checkbox carrying the marker, preserving
 * indentation and replacing any existing list bullet.
 */
export function applyCreateMarker(line: string, taskId: string): string {
  const [, indent, rest] = line.match(LINE_PREFIX_RE) as RegExpMatchArray;
  const marker = taskMarker(taskId);
  return rest ? `${indent}- [x] ${marker} ${rest}` : `${indent}- [x] ${marker}`;
}

/**
 * Rewrite a line for "append to task notes". Lighter than the create marker —
 * no checkbox, because nothing was created and the line isn't done.
 */
export function applyAppendMarker(line: string, taskId: string): string {
  return `${line.replace(/\s+$/, '')} ${taskMarker(taskId)}`;
}

/**
 * Collapse a selected block to a one-line task title.
 *
 * Markers are stripped: a title carrying a `[tsk:...]` token would be indexed
 * as a link the moment that title appeared in any body, inventing a reference
 * the user never wrote.
 */
export function collapseToTitle(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(TASK_MARKER_RE, '')
        .replace(/^\s*(?:[-*+]\s+|\d+\.\s+)?(?:\[[ xX]\]\s*)?/, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
