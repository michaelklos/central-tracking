import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskProvider, useTaskContext } from '../TaskContext';
import type { Task } from '../../../shared/types';

function makeTask(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    status: 'todo',
    source: 'ad-hoc',
    externalId: null,
    pluginId: null,
    sortOrder: 0,
    totalTimeSeconds: 0,
    todayTimeSeconds: 0,
    unreportedTimeSeconds: 0,
    hasUnreportedTime: false,
    categoryIds: [],
    notes: '',
    deletedAt: null,
    externalUrl: null,
    externalState: null,
    externalCompletedHours: null,
    externalRefreshedAt: null,
    stateDirty: false,
    createdAt: '2026-09-03T10:00:00.000Z',
    updatedAt: '2026-09-03T10:00:00.000Z',
  };
}

const page1 = Array.from({ length: 50 }, (_, i) => makeTask(`a${i}`));
const page2 = Array.from({ length: 50 }, (_, i) => makeTask(`b${i}`));

/** Serves pages out of a fixed 100-task backing list. */
function pagedGetActive(all: Task[]) {
  return vi.fn(async ({ offset = 0, limit = 50 }: { offset?: number; limit?: number }) => {
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, offset, limit, hasMore: offset + items.length < all.length };
  });
}

function Consumer() {
  const ctx = useTaskContext();
  return (
    <div>
      <span data-testid="active-count">{ctx.activeTasks.length}</span>
      <span data-testid="tasks-ids">{ctx.tasks.map((t) => t.id).join(',')}</span>
      <span data-testid="batch-mode">{String(ctx.batchMode)}</span>
      <span data-testid="selected">{Array.from(ctx.selectedTaskIds).join(',')}</span>
      <button data-testid="load-more" onClick={() => ctx.loadMoreActiveTasks()}>more</button>
      <button data-testid="refresh" onClick={() => ctx.refreshActiveTasks()}>refresh</button>
      <span data-testid="todo-count">{ctx.statusSections['todo']?.items.length ?? 0}</span>
      <span data-testid="todo-total">{ctx.statusSections['todo']?.total ?? 0}</span>
      <button data-testid="load-more-todo" onClick={() => ctx.loadMoreStatusTasks('todo')}>more todo</button>
      <span data-testid="wip-total">{ctx.statusSections['in-progress']?.total ?? 0}</span>
      <button
        data-testid="filter-wip"
        onClick={() => ctx.setFilter((prev) => ({ ...prev, statuses: ['in-progress'] }))}
      >filter</button>
      <button data-testid="create" onClick={() => ctx.createTask({ title: 'New' })}>create</button>
      <button data-testid="enter-batch" onClick={() => { ctx.enterBatchMode(); ctx.selectAllTasks(['a0', 'a1']); }}>batch</button>
      <button data-testid="batch-update" onClick={() => ctx.batchUpdateTasks({ status: 'done' })}>apply</button>
      <button data-testid="batch-report" onClick={() => ctx.batchMarkSelectedReported('2026-09-03T10:00:00.000Z')}>report</button>
    </div>
  );
}

async function renderProvider() {
  render(
    <TaskProvider>
      <Consumer />
    </TaskProvider>
  );
  await waitFor(() => expect(screen.getByTestId('active-count').textContent).not.toBe('0'));
}

describe('TaskContext pagination window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.api.tasks.getActive = pagedGetActive([...page1, ...page2]) as never;
  });

  it('a refresh restores every page that was loaded, not just the first', async () => {
    const user = userEvent.setup();
    await renderProvider();
    expect(screen.getByTestId('active-count').textContent).toBe('50');

    await user.click(screen.getByTestId('load-more'));
    expect(screen.getByTestId('active-count').textContent).toBe('100');

    await user.click(screen.getByTestId('refresh'));
    expect(screen.getByTestId('active-count').textContent).toBe('100');
    // Not "last": a refresh also fetches each status section. `status:
    // undefined` picks out the flat-list call from the per-status ones.
    expect(window.api.tasks.getActive).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 100, status: undefined })
    );
  });

  it('pages from the loaded count, not from a stale render closure', async () => {
    const user = userEvent.setup();
    await renderProvider();
    await user.click(screen.getByTestId('load-more'));
    expect(window.api.tasks.getActive).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 50, limit: 50 })
    );
  });
});

describe('TaskContext page size setting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.api.tasks.getActive = pagedGetActive([...page1, ...page2]) as never;
  });

  it('loads the configured page size instead of the built-in 50', async () => {
    localStorage.setItem('ct-option-page-size', '75');
    await renderProvider();

    await waitFor(() => expect(screen.getByTestId('active-count').textContent).toBe('75'));
    expect(window.api.tasks.getActive).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 75 })
    );
  });

  it('clamps a page size below the settings minimum', async () => {
    localStorage.setItem('ct-option-page-size', '1');
    await renderProvider();

    await waitFor(() => expect(window.api.tasks.getActive).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    ));
  });

  it('falls back to 50 for a partially-numeric value rather than reading its prefix', async () => {
    localStorage.setItem('ct-option-page-size', '75abc');
    await renderProvider();

    await waitFor(() => expect(screen.getByTestId('active-count').textContent).toBe('50'));
  });

  it('falls back to 50 when the stored value is not a usable number', async () => {
    localStorage.setItem('ct-option-page-size', 'lots');
    await renderProvider();

    await waitFor(() => expect(screen.getByTestId('active-count').textContent).toBe('50'));
  });
});

describe('TaskContext created-task slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only ever serves the first page: a newly created task sorts to the tail
    // of the full list and so never comes back in it.
    window.api.tasks.getActive = pagedGetActive(page1) as never;
  });

  it('resolves a task created past the loaded pages, so selecting it works', async () => {
    const user = userEvent.setup();
    window.api.tasks.create = vi.fn().mockResolvedValue(makeTask('brand-new')) as never;
    await renderProvider();
    expect(screen.getByTestId('tasks-ids').textContent).not.toContain('brand-new');

    await user.click(screen.getByTestId('create'));
    expect(screen.getByTestId('tasks-ids').textContent).toContain('brand-new');
  });

  it('drops the slot once a page actually contains the task, without duplicating it', async () => {
    const user = userEvent.setup();
    const created = makeTask('brand-new');
    window.api.tasks.create = vi.fn().mockResolvedValue(created) as never;
    await renderProvider();
    await user.click(screen.getByTestId('create'));

    window.api.tasks.getActive = pagedGetActive([created, ...page1]) as never;
    await user.click(screen.getByTestId('refresh'));

    const ids = screen.getByTestId('tasks-ids').textContent!.split(',');
    expect(ids.filter((id) => id === 'brand-new')).toHaveLength(1);
  });
});

describe('TaskContext batch operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.api.tasks.getActive = pagedGetActive(page1) as never;
    window.api.tasks.getDone = vi.fn().mockResolvedValue(
      { items: [], total: 3, offset: 0, limit: 0, hasMore: false }
    ) as never;
  });

  it('keeps batch mode and the selection after applying an update', async () => {
    const user = userEvent.setup();
    await renderProvider();
    await user.click(screen.getByTestId('enter-batch'));
    await user.click(screen.getByTestId('batch-update'));

    expect(screen.getByTestId('batch-mode').textContent).toBe('true');
    expect(screen.getByTestId('selected').textContent).toBe('a0,a1');
  });

  it('refreshes the Done badge count after a batch report, even when Done is collapsed', async () => {
    const user = userEvent.setup();
    await renderProvider();
    await user.click(screen.getByTestId('enter-batch'));
    (window.api.tasks.getDone as ReturnType<typeof vi.fn>).mockClear();

    await user.click(screen.getByTestId('batch-report'));

    await waitFor(() => expect(window.api.tasks.getDone).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 0 })
    ));
  });
});


describe('TaskContext status sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  /** Serves per-status pages; the flat call (no status) sees everything. */
  function sectionedGetActive(byStatus: Record<string, Task[]>) {
    const all = Object.values(byStatus).flat();
    return vi.fn(async (
      { offset = 0, limit = 50, status }: { offset?: number; limit?: number; status?: string[] },
    ) => {
      const pool = status?.length ? (byStatus[status[0]] ?? []) : all;
      const items = pool.slice(offset, offset + limit);
      return { items, total: pool.length, offset, limit, hasMore: offset + items.length < pool.length };
    });
  }

  it('pages each status independently and reports that status\'s total', async () => {
    const user = userEvent.setup();
    localStorage.setItem('ct-option-page-size', '10');
    const todos = Array.from({ length: 25 }, (_, i) => makeTask(`t${i}`));
    window.api.tasks.getActive = sectionedGetActive({ todo: todos }) as never;

    await renderProvider();

    // The section holds one page, but its pill counts every matching task.
    await waitFor(() => expect(screen.getByTestId('todo-count').textContent).toBe('10'));
    expect(screen.getByTestId('todo-total').textContent).toBe('25');

    await user.click(screen.getByTestId('load-more-todo'));
    expect(screen.getByTestId('todo-count').textContent).toBe('20');
    expect(window.api.tasks.getActive).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 10, limit: 10, status: ['todo'] })
    );
  });

  it('restores every loaded section page on a refresh', async () => {
    const user = userEvent.setup();
    localStorage.setItem('ct-option-page-size', '10');
    const todos = Array.from({ length: 25 }, (_, i) => makeTask(`t${i}`));
    window.api.tasks.getActive = sectionedGetActive({ todo: todos }) as never;

    await renderProvider();
    await user.click(screen.getByTestId('load-more-todo'));
    await user.click(screen.getByTestId('refresh'));

    await waitFor(() => expect(screen.getByTestId('todo-count').textContent).toBe('20'));
    expect(window.api.tasks.getActive).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 20, status: ['todo'] })
    );
  });

  it('empties the sections a status filter excludes, without querying them', async () => {
    const user = userEvent.setup();
    const getActive = sectionedGetActive({
      todo: Array.from({ length: 3 }, (_, i) => makeTask(`t${i}`)),
      'in-progress': Array.from({ length: 2 }, (_, i) => makeTask(`w${i}`)),
    });
    window.api.tasks.getActive = getActive as never;

    await renderProvider();
    await waitFor(() => expect(screen.getByTestId('todo-total').textContent).toBe('3'));

    const todoCallsBefore = getActive.mock.calls
      .filter(([params]) => params.status?.[0] === 'todo').length;

    await user.click(screen.getByTestId('filter-wip'));

    // The filtered-out section is emptied rather than left showing stale rows.
    await waitFor(() => expect(screen.getByTestId('todo-total').textContent).toBe('0'));
    expect(screen.getByTestId('todo-count').textContent).toBe('0');
    expect(screen.getByTestId('wip-total').textContent).toBe('2');
    // An excluded section is emptied outright — no query goes out for it.
    expect(getActive.mock.calls.filter(
      ([params]) => params.status?.[0] === 'todo',
    )).toHaveLength(todoCallsBefore);
  });
});
