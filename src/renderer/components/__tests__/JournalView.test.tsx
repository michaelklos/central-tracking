import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { JournalView } from '../JournalView';
import { createMockApi } from '../../../test/mocks/api';
import type { CentralTrackingAPI, Journal, JournalListItem } from '../../../shared/types';

const BODY = 'Vendor pushed the date.\n- Chase the SLA numbers';

const makeJournal = (overrides: Partial<Journal> = {}): Journal => ({
  id: 'journal-1',
  title: 'Vendor sync',
  body: BODY,
  deletedAt: null,
  createdAt: '2026-09-04T10:00:00Z',
  updatedAt: '2026-09-04T10:00:00Z',
  ...overrides,
});

const makeListItem = (overrides: Partial<JournalListItem> = {}): JournalListItem => ({
  ...makeJournal(),
  matches: [],
  ...overrides,
});

let api: CentralTrackingAPI;

const navigate = vi.fn();
const selectTask = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => ({ selectTask }),
}));

const renderView = () => render(<JournalView />, { wrapper: MemoryRouter });

/**
 * The editor textarea. Queried by placeholder rather than display value:
 * testing-library normalizes whitespace, so a multi-line body never matches.
 */
async function editor(): Promise<HTMLTextAreaElement> {
  return (await screen.findByPlaceholderText(/Type your notes/)) as HTMLTextAreaElement;
}

/** Wait until the editor holds exactly `value`. */
async function expectEditorValue(value: string) {
  const textarea = await editor();
  await waitFor(() => expect(textarea.value).toBe(value));
  return textarea;
}

/** Select `needle` inside the editor textarea and right-click on it. */
async function rightClickSelection(needle: string) {
  const textarea = await editor();
  const start = BODY.indexOf(needle);
  textarea.setSelectionRange(start, start + needle.length);
  fireEvent.contextMenu(textarea, { clientX: 100, clientY: 100 });
  return { start, end: start + needle.length };
}

describe('JournalView', () => {
  beforeEach(() => {
    api = createMockApi();
    api.journals.getAll = vi.fn().mockResolvedValue([makeListItem()]);
    api.journals.getById = vi.fn().mockResolvedValue(makeJournal());
    api.tasks.getById = vi.fn().mockResolvedValue(null);
    (window as unknown as { api: CentralTrackingAPI }).api = api;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists entries and opens one', async () => {
    renderView();
    const entry = await screen.findByText('Vendor sync');
    await userEvent.click(entry);
    await expectEditorValue(BODY);
  });

  it('shows the matching lines under a search hit, not just the title', async () => {
    api.journals.getAll = vi.fn().mockResolvedValue([
      makeListItem({ matches: [{ lineNumber: 2, text: '- Chase the SLA numbers' }] }),
    ]);
    renderView();
    expect(await screen.findByText(/Chase the SLA numbers/)).toBeInTheDocument();
  });

  describe('selection actions', () => {
    // The offsets are snapshotted at right-click time. If they were read when
    // the menu item is clicked, focus would have moved to the button and the
    // selection would have collapsed — creating a task from nothing.
    it('passes the offsets captured at right-click time', async () => {
      const rewritten = makeJournal({ body: `${BODY} [marked]` });
      api.journals.createTaskFromSelection = vi
        .fn()
        .mockResolvedValue({ journal: rewritten, task: { id: 'task-1', title: 'Chase' } });

      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      await expectEditorValue(BODY);

      const { start, end } = await rightClickSelection('Chase the SLA numbers');
      const item = await screen.findByRole('menuitem', { name: 'Create to-do' });

      // What the browser does when focus moves to the menu: the textarea's
      // selection collapses. Reading it now would send an empty range.
      (await editor()).setSelectionRange(0, 0);
      await userEvent.click(item);

      expect(api.journals.createTaskFromSelection).toHaveBeenCalledWith({
        journalId: 'journal-1',
        selectionStart: start,
        selectionEnd: end,
      });
    });

    it('replaces the editor value with the server-rewritten body', async () => {
      const rewritten = makeJournal({
        body: 'Vendor pushed the date.\n- [tsk:abcd1234] Chase the SLA numbers',
      });
      api.journals.createTaskFromSelection = vi
        .fn()
        .mockResolvedValue({ journal: rewritten, task: { id: 'abcd1234-0000', title: 'Chase' } });

      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      await expectEditorValue(BODY);

      await rightClickSelection('Chase the SLA numbers');
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Create to-do' }));

      await expectEditorValue(rewritten.body);
    });

    // Right-clicking a bullet with no selection is the obvious gesture, and
    // the server expands any range to whole lines anyway — so a bare caret is
    // a valid selection, and the whole line becomes the task.
    it('acts on the caret line when nothing is selected', async () => {
      const rewritten = makeJournal({ body: `${BODY} [tsk:abcd1234]` });
      api.journals.createTaskFromSelection = vi
        .fn()
        .mockResolvedValue({ journal: rewritten, task: { id: 'abcd1234-0000', title: 'Chase' } });

      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      const textarea = await expectEditorValue(BODY);

      const caret = BODY.indexOf('Chase') + 3;
      textarea.setSelectionRange(caret, caret);
      fireEvent.contextMenu(textarea, { clientX: 100, clientY: 100 });

      // The menu previews the whole line, not an empty string.
      expect(await screen.findByText(/“- Chase the SLA numbers”/)).toBeInTheDocument();
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Create to-do' }));

      expect(api.journals.createTaskFromSelection).toHaveBeenCalledWith({
        journalId: 'journal-1',
        selectionStart: caret,
        selectionEnd: caret,
      });
    });

    it('does not open the menu on a blank line', async () => {
      api.journals.getById = vi.fn().mockResolvedValue(makeJournal({ body: 'one\n\ntwo' }));
      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      const textarea = await expectEditorValue('one\n\ntwo');

      textarea.setSelectionRange(4, 4);
      fireEvent.contextMenu(textarea, { clientX: 100, clientY: 100 });

      expect(screen.queryByRole('menuitem', { name: 'Create to-do' })).not.toBeInTheDocument();
    });

    // A marked line can never produce another task, so the menu offers the
    // one it names rather than letting the user click into a guaranteed error.
    it('offers "go to task" on a marked line and blocks a second create', async () => {
      api.journals.getById = vi
        .fn()
        .mockResolvedValue(makeJournal({ body: '- [tsk:abcd1234] Chase the SLA numbers' }));
      api.tasks.getById = vi
        .fn()
        .mockResolvedValue({ id: 'abcd1234-0000', title: 'Chase the SLA numbers' });

      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      const textarea = await expectEditorValue('- [tsk:abcd1234] Chase the SLA numbers');

      textarea.setSelectionRange(20, 20);
      fireEvent.contextMenu(textarea, { clientX: 100, clientY: 100 });

      expect(await screen.findByRole('menuitem', { name: /Create to-do/ })).toBeDisabled();
      // A disabled button fires no mouse events, so the reason can't live in
      // a `title` tooltip — it has to be on screen.
      expect(screen.getByText('Already linked to a task')).toBeInTheDocument();

      await userEvent.click(await screen.findByRole('menuitem', { name: /Go to/ }));
      expect(selectTask).toHaveBeenCalledWith('abcd1234-0000');
      expect(navigate).toHaveBeenCalledWith('/');
      expect(api.journals.createTaskFromSelection).not.toHaveBeenCalled();
    });

    it('opens the task a linked row names', async () => {
      api.journals.getById = vi
        .fn()
        .mockResolvedValue(makeJournal({ body: '- [tsk:abcd1234] Chase the SLA numbers' }));
      api.tasks.getById = vi
        .fn()
        .mockResolvedValue({ id: 'abcd1234-0000', title: 'Chase the SLA numbers' });

      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));

      await userEvent.click(await screen.findByTitle('Open this task'));
      expect(selectTask).toHaveBeenCalledWith('abcd1234-0000');
      expect(navigate).toHaveBeenCalledWith('/');
    });

    // A pending debounced save holds the pre-marker draft. Firing after the
    // action would overwrite the marker the server just wrote.
    it('drops a pending autosave rather than overwriting the new marker', async () => {
      const rewritten = makeJournal({ body: `${BODY} [tsk:abcd1234]` });
      api.journals.createTaskFromSelection = vi
        .fn()
        .mockResolvedValue({ journal: rewritten, task: { id: 'abcd1234-0000', title: 'Chase' } });

      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      const textarea = await expectEditorValue(BODY);

      await userEvent.type(textarea, ' edited');
      await rightClickSelection('Chase the SLA numbers');
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Create to-do' }));

      await expectEditorValue(rewritten.body);
      // The flush before opening the menu is the only update; nothing fires
      // afterward carrying the stale pre-marker body.
      const bodies = (api.journals.update as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[1] as { body?: string }).body,
      );
      expect(bodies.every((b) => b === undefined || !b.includes('[tsk:'))).toBe(true);
      await expectEditorValue(rewritten.body);
    });

    it('appends to a task picked from the menu', async () => {
      const rewritten = makeJournal({ body: `${BODY} [tsk:abcd1234]` });
      api.tasks.getActive = vi.fn().mockResolvedValue({
        items: [{ id: 'abcd1234-0000', title: 'Vendor SLA' }],
        total: 1,
        offset: 0,
        limit: 8,
        hasMore: false,
      });
      api.journals.appendSelectionToTask = vi
        .fn()
        .mockResolvedValue({ journal: rewritten, task: { id: 'abcd1234-0000', title: 'Vendor SLA' } });

      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      await expectEditorValue(BODY);

      const { start, end } = await rightClickSelection('Chase the SLA numbers');
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Append to task notes…' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Vendor SLA' }));

      expect(api.journals.appendSelectionToTask).toHaveBeenCalledWith({
        journalId: 'journal-1',
        taskId: 'abcd1234-0000',
        selectionStart: start,
        selectionEnd: end,
      });
      await expectEditorValue(rewritten.body);
    });
  });

  // The action sets the draft to avoid a flash, but the mutation also fires
  // `ct:data-changed`. This pins which side wins: the server's copy.
  it('lets a data-changed refresh re-read the open entry', async () => {
    let fire: (() => void) | undefined;
    api.onDataChanged = vi.fn((cb: () => void) => {
      fire = cb;
      return () => {};
    }) as CentralTrackingAPI['onDataChanged'];

    renderView();
    await userEvent.click(await screen.findByText('Vendor sync'));
    await expectEditorValue(BODY);

    const fromServer = makeJournal({ body: 'Rewritten elsewhere' });
    api.journals.getById = vi.fn().mockResolvedValue(fromServer);
    fire?.();

    await expectEditorValue('Rewritten elsewhere');
  });

  it('keeps an unsaved draft when a refresh arrives mid-edit', async () => {
    let fire: (() => void) | undefined;
    api.onDataChanged = vi.fn((cb: () => void) => {
      fire = cb;
      return () => {};
    }) as CentralTrackingAPI['onDataChanged'];

    renderView();
    await userEvent.click(await screen.findByText('Vendor sync'));
    const textarea = await expectEditorValue(BODY);

    await userEvent.type(textarea, ' typing');
    api.journals.getById = vi.fn().mockResolvedValue(makeJournal({ body: 'Rewritten elsewhere' }));
    fire?.();

    await expectEditorValue(`${BODY} typing`);
  });

  describe('entry date', () => {
    it('saves a new date and re-files the entry in the list', async () => {
      api.journals.update = vi
        .fn()
        .mockResolvedValue(makeJournal({ createdAt: '2026-08-01T09:30:00.000Z' }));

      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      await expectEditorValue(BODY);

      await userEvent.click(screen.getByTitle('Change when this note was taken'));
      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2026-08-01' } });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      // Changing only the date keeps the entry's original time of day, and the
      // fields are local, so the expected instant is built the same way.
      const original = new Date(makeJournal().createdAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const expected = new Date(
        `2026-08-01T${pad(original.getHours())}:${pad(original.getMinutes())}:00`,
      ).toISOString();

      await waitFor(() =>
        expect(api.journals.update).toHaveBeenCalledWith('journal-1', { createdAt: expected }),
      );
      // Moving the date changes the ordering, so the list is re-read.
      expect(api.journals.getAll).toHaveBeenCalledTimes(2);
    });

    it('rejects an unparseable date without calling the server', async () => {
      renderView();
      await userEvent.click(await screen.findByText('Vendor sync'));
      await expectEditorValue(BODY);

      await userEvent.click(screen.getByTitle('Change when this note was taken'));
      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '' } });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Not a valid date');
      expect(api.journals.update).not.toHaveBeenCalled();
    });
  });

  describe('?entry= deep link', () => {
    const renderAt = (url: string) =>
      render(<JournalView />, {
        wrapper: ({ children }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>,
      });

    it('opens the linked entry on arrival', async () => {
      renderAt('/journal?entry=journal-1');
      await expectEditorValue(BODY);
      expect(api.journals.getById).toHaveBeenCalledWith('journal-1');
    });

    // Arriving from a task link must not discard an in-progress note.
    it('leaves a dirty draft alone', async () => {
      renderAt('/journal');
      await userEvent.click(await screen.findByText('Vendor sync'));
      const textarea = await expectEditorValue(BODY);
      await userEvent.type(textarea, ' typing');

      await expectEditorValue(`${BODY} typing`);
    });
  });

  it('offers an undo after deleting an entry', async () => {
    renderView();
    await userEvent.click(await screen.findByText('Vendor sync'));
    await expectEditorValue(BODY);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.journals.delete).toHaveBeenCalledWith('journal-1');

    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.journals.restore).toHaveBeenCalledWith('journal-1'));
  });

  it('lists the tasks a note produced', async () => {
    api.journals.getById = vi.fn().mockResolvedValue(
      makeJournal({ body: '- [tsk:abcd1234] Chase the SLA numbers' }),
    );
    api.tasks.getById = vi.fn().mockResolvedValue({ id: 'abcd1234-0000', title: 'Chase the SLA numbers' });

    renderView();
    await userEvent.click(await screen.findByText('Vendor sync'));

    expect(await screen.findByText('Tasks from this note')).toBeInTheDocument();
    expect(api.tasks.getById).toHaveBeenCalledWith('abcd1234');
  });
});
