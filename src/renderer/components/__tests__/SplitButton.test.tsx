import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitButton } from '../SplitButton';

describe('SplitButton', () => {
  it('primary action fires on main button click', async () => {
    const primary = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitButton
        primaryLabel="Add + Start"
        primaryAction={primary}
        alternatives={[{ label: 'Add as To-Do', action: vi.fn() }]}
      />
    );

    await user.click(screen.getByText('Add + Start'));
    expect(primary).toHaveBeenCalled();
  });

  it('dropdown opens on arrow click', async () => {
    const user = userEvent.setup();
    render(
      <SplitButton
        primaryLabel="Add + Start"
        primaryAction={vi.fn()}
        alternatives={[{ label: 'Add as To-Do', action: vi.fn() }]}
      />
    );

    await user.click(screen.getByTitle('More options'));
    expect(screen.getByText('Add as To-Do')).toBeInTheDocument();
  });

  it('selecting alternative fires its callback', async () => {
    const altAction = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitButton
        primaryLabel="Add + Start"
        primaryAction={vi.fn()}
        alternatives={[{ label: 'Add as To-Do', action: altAction }]}
      />
    );

    await user.click(screen.getByTitle('More options'));
    await user.click(screen.getByText('Add as To-Do'));
    expect(altAction).toHaveBeenCalled();
  });
});
