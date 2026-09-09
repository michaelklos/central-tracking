import type { Task } from '../../shared/types';

/** Mirrors SECTION_STATUSES in TaskContext, for tests that mock that module. */
export const SECTION_STATUSES = ['todo', 'in-progress', 'blocked'] as const;

export interface MockSection {
  items: Task[];
  total: number;
  hasMore: boolean;
}

/**
 * Fixture status sections built from a flat task list, so a test that only
 * cares about rows can keep setting `activeTasks` and get the sections the
 * status-grouped list actually reads. `totals` overrides a section's count
 * when a test needs a total larger than the rows it loaded.
 */
export function sectionsFromTasks(
  tasks: readonly unknown[],
  totals: Record<string, number> = {},
): Record<string, MockSection> {
  const sections: Record<string, MockSection> = {};
  for (const status of SECTION_STATUSES) {
    const items = (tasks as Task[]).filter((t) => t.status === status);
    sections[status] = { items, total: totals[status] ?? items.length, hasMore: false };
  }
  return sections;
}
