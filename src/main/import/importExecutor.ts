import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { ImportPreviewItem, ImportResult, ImportError } from '../../shared/types';
import { parseMarkdownImport } from './markdownParser';

export function parseImportContent(db: Database, content: string): { items: ImportPreviewItem[]; errors: ImportError[] } {
  const { items, errors } = parseMarkdownImport(content);

  const previewItems: ImportPreviewItem[] = items.map((item) => {
    let existingTask: { id: string; title: string } | null = null;

    if (item.externalId) {
      const row = db.instance
        .prepare('SELECT id, title FROM tasks WHERE external_id = ? AND deleted_at IS NULL')
        .get(item.externalId) as { id: string; title: string } | undefined;
      if (row) {
        existingTask = { id: row.id, title: row.title };
      }
    } else {
      // No ticket — match by exact title to avoid creating duplicates
      const row = db.instance
        .prepare('SELECT id, title FROM tasks WHERE title = ? AND deleted_at IS NULL LIMIT 1')
        .get(item.title) as { id: string; title: string } | undefined;
      if (row) {
        existingTask = { id: row.id, title: row.title };
      }
    }

    return {
      ...item,
      existingTask,
      // 'update' = add a time entry to the existing task; 'create' = new task
      action: existingTask ? 'update' as const : 'create' as const,
    };
  });

  return { items: previewItems, errors };
}

export function executeImport(db: Database, items: ImportPreviewItem[]): ImportResult {
  const actionableItems = items.filter((item) => item.action !== 'skip');
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  const insertTask = db.instance.prepare(
    `INSERT INTO tasks (id, title, description, status, source, external_id, plugin_id, sort_order, created_at, updated_at)
     VALUES (?, ?, '', 'todo', ?, ?, ?, ?, ?, ?)`
  );

  const insertTimeEntry = db.instance.prepare(
    `INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at)
     VALUES (?, ?, ?, ?, ?, '', ?)`
  );

  const getMaxOrder = db.instance.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM tasks'
  );

  const transaction = db.instance.transaction(() => {
    // Track titles created in this import run so multiple lines for the same
    // title don't produce duplicate tasks.
    const titleToTaskId = new Map<string, string>();

    for (const item of actionableItems) {
      try {
        const now = new Date().toISOString();
        let taskId: string;

        if (item.action === 'update' && item.existingTask) {
          // Add time entry to an already-existing task
          taskId = item.existingTask.id;
          updated++;
        } else {
          // 'create' — but check if we already created this title in the current batch
          const existing = titleToTaskId.get(item.title);
          if (existing) {
            taskId = existing;
            // Counts as another entry on the same newly-created task, not a new task
          } else {
            taskId = uuidv4();
            const { next: sortOrder } = getMaxOrder.get() as { next: number };
            insertTask.run(
              taskId,
              item.title,
              item.source,
              item.externalId,
              item.pluginId,
              sortOrder,
              now,
              now
            );
            titleToTaskId.set(item.title, taskId);
            created++;
          }
        }

        const timeEntryId = uuidv4();
        insertTimeEntry.run(
          timeEntryId,
          taskId,
          item.startDateTime,
          item.endDateTime,
          item.durationSeconds,
          now
        );
      } catch (err) {
        errors.push(`Failed to import "${item.title}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  transaction();

  return {
    created,
    skipped: items.length - actionableItems.length,
    errors,
  };
}
