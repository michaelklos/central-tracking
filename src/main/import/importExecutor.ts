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
        .prepare('SELECT id, title FROM tasks WHERE external_id = ?')
        .get(item.externalId) as { id: string; title: string } | undefined;
      if (row) {
        existingTask = { id: row.id, title: row.title };
      }
    }

    return {
      ...item,
      existingTask,
      action: existingTask ? 'skip' as const : 'create' as const,
    };
  });

  return { items: previewItems, errors };
}

export function executeImport(db: Database, items: ImportPreviewItem[]): ImportResult {
  const toCreate = items.filter((item) => item.action === 'create');
  let created = 0;
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
    for (const item of toCreate) {
      try {
        const taskId = uuidv4();
        const now = new Date().toISOString();
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

        const timeEntryId = uuidv4();
        insertTimeEntry.run(
          timeEntryId,
          taskId,
          item.startDateTime,
          item.endDateTime,
          item.durationSeconds,
          now
        );

        created++;
      } catch (err) {
        errors.push(`Failed to create "${item.title}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  transaction();

  return {
    created,
    skipped: items.length - toCreate.length,
    errors,
  };
}
