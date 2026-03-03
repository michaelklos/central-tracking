import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OptionsMenu } from '../OptionsMenu';

describe('OptionsMenu', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
