import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateRangePicker } from '../DateRangePicker';

describe('DateRangePicker', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders start and end date inputs', () => {
    render(<DateRangePicker start="2024-01-01" end="2024-01-31" onChange={onChange} />);
    const inputs = screen.getAllByDisplayValue(/2024/);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('preset buttons exist', () => {
    render(<DateRangePicker start="2024-01-01" end="2024-01-31" onChange={onChange} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
  });

  it('onChange fires when a preset is clicked', async () => {
    const user = userEvent.setup();
    render(<DateRangePicker start="2024-01-01" end="2024-01-31" onChange={onChange} />);
    await user.click(screen.getByText('Today'));
    expect(onChange).toHaveBeenCalled();
  });
});
