import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders title, message, and buttons', () => {
    render(
      <ConfirmDialog
        title="Delete Task"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Delete Task')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('uses custom button labels', () => {
    render(
      <ConfirmDialog
        title="Test"
        message="msg"
        confirmLabel="Yes, do it"
        cancelLabel="Nope"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Yes, do it')).toBeInTheDocument();
    expect(screen.getByText('Nope')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Test"
        message="msg"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    await userEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Test"
        message="msg"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    await userEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when overlay clicked', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Test"
        message="msg"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    // Click the overlay (outermost element)
    const overlay = document.querySelector('.confirm-overlay') as HTMLElement;
    await userEvent.click(overlay);
    expect(onCancel).toHaveBeenCalled();
  });

  it('applies danger variant class', () => {
    render(
      <ConfirmDialog
        title="Delete"
        message="msg"
        variant="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('danger');
  });
});
