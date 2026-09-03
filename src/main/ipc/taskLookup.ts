import type { Database } from '../database/database';
import { DomainError } from '../errors';

/**
 * Task-id resolution shared by every handler that accepts a task id.
 *
 * The CLI advertises "UUID, prefix, or name substring" for the timer, time,
 * comment, category and report commands, so all of those entry points have to
 * resolve the same way the task commands do. Lives in its own module rather
 * than being exported from `taskHandlers` so the four other handler modules
 * can use it without importing each other.
 */

// Escape `%`, `_`, and `\` so user input is matched literally by SQLite's LIKE.
// Pairs with `ESCAPE '\'` in the queries below.
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Resolve a user-supplied task reference to a full task id: a UUID passes
 * through, otherwise an exact id/title match, then an id prefix, then a
 * case-insensitive title substring.
 *
 * Throws `DomainError` so the failure carries a code and an HTTP status
 * instead of relying on the caller to substring-match the message.
 */
export function resolveTaskId(db: Database, id: string): string {
  // Full UUID — return as-is
  if (id.length >= 36) return id;

  // Exact-match fast path (also protects against `%`/`_` in the input)
  const exact = db.instance
    .prepare('SELECT id FROM tasks WHERE id = ? OR title = ?')
    .all(id, id) as { id: string }[];
  if (exact.length === 1) return exact[0].id;

  const escaped = escapeLike(id);

  // Try ID prefix match
  const byId = db.instance
    .prepare("SELECT id FROM tasks WHERE id LIKE ? ESCAPE '\\'")
    .all(`${escaped}%`) as { id: string }[];
  if (byId.length === 1) return byId[0].id;
  if (byId.length > 1) {
    throw new DomainError(
      'AMBIGUOUS_ID',
      `Ambiguous ID prefix "${id}" matches ${byId.length} tasks. Use more characters.`,
    );
  }

  // Fall back to case-insensitive title match
  const byTitle = db.instance
    .prepare("SELECT id FROM tasks WHERE title LIKE ? ESCAPE '\\' AND deleted_at IS NULL")
    .all(`%${escaped}%`) as { id: string }[];
  if (byTitle.length === 1) return byTitle[0].id;
  if (byTitle.length > 1) {
    throw new DomainError(
      'AMBIGUOUS_ID',
      `Ambiguous name "${id}" matches ${byTitle.length} tasks. Be more specific.`,
    );
  }

  throw new DomainError('NOT_FOUND', `Task not found: ${id}`, 404);
}
