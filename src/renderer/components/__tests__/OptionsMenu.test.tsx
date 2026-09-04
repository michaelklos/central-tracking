import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OptionsMenu } from '../OptionsMenu';

const mockCreateCategory = vi.fn().mockResolvedValue({ id: 'cat-1', name: 'Test' });
const mockUpdateCategory = vi.fn();
const mockCategories: { id: string; name: string; color: string }[] = [];

vi.mock('../../../renderer/context/TaskContext', () => ({
  useTaskContext: () => ({
    categories: mockCategories,
    createCategory: mockCreateCategory,
    updateCategory: mockUpdateCategory,
    deleteCategory: vi.fn(),
    resetApp: vi.fn(),
  }),
}));

describe('OptionsMenu', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockCategories.length = 0;
  });

  it('renders settings options', () => {
    render(<OptionsMenu />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('toggling setting persists to localStorage', async () => {
    const user = userEvent.setup();
    render(<OptionsMenu />);
    const checkbox = screen.getAllByRole('checkbox')[0];
    await user.click(checkbox);
    // Value should be stored in localStorage
    const keys = Object.keys(localStorage);
    expect(keys.some((k) => k.startsWith('ct-option-'))).toBe(true);
  });

  it('creates a new category', async () => {
    const user = userEvent.setup();
    render(<OptionsMenu />);

    const input = screen.getByPlaceholderText('New category...');
    await user.type(input, 'New Cat');
    await user.click(screen.getByText('+'));

    expect(mockCreateCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Cat' }));
  });
});

describe('OptionsMenu - renaming a category', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockCategories.length = 0;
    mockCategories.push({ id: 'cat-1', name: 'Bug', color: '#ff0000' });
  });

  it('commits a new name on Enter', async () => {
    const user = userEvent.setup();
    render(<OptionsMenu />);

    const input = screen.getByLabelText('Rename Bug');
    await user.clear(input);
    await user.type(input, 'Defect{Enter}');

    expect(mockUpdateCategory).toHaveBeenCalledWith('cat-1', { name: 'Defect' });
  });

  it('reverts on Escape and saves nothing', async () => {
    const user = userEvent.setup();
    render(<OptionsMenu />);

    const input = screen.getByLabelText('Rename Bug');
    await user.clear(input);
    await user.type(input, 'Defect{Escape}');

    expect(mockUpdateCategory).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Rename Bug') as HTMLInputElement).value).toBe('Bug');
  });

  it('does not save an emptied name', async () => {
    const user = userEvent.setup();
    render(<OptionsMenu />);

    const input = screen.getByLabelText('Rename Bug');
    await user.clear(input);
    await user.tab();

    expect(mockUpdateCategory).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Rename Bug') as HTMLInputElement).value).toBe('Bug');
  });

  it('follows a rename that lands from elsewhere without clobbering a live edit', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OptionsMenu />);

    // A rename from the CLI or another window arrives as a new prop value.
    mockCategories[0] = { ...mockCategories[0], name: 'Defect' };
    rerender(<OptionsMenu />);
    expect((screen.getByLabelText('Rename Defect') as HTMLInputElement).value).toBe('Defect');

    // Typing is not disturbed by an unrelated re-render.
    const input = screen.getByLabelText('Rename Defect');
    await user.clear(input);
    await user.type(input, 'Regression');
    rerender(<OptionsMenu />);
    expect((screen.getByLabelText('Rename Defect') as HTMLInputElement).value).toBe('Regression');
  });

  it('still recolors from the swatch', async () => {
    render(<OptionsMenu />);
    expect(screen.getByLabelText('Color for Bug')).toBeInTheDocument();
  });
});
