import { describe, it, expect } from 'vitest';
import { formatDuration } from '../time';

describe('formatDuration', () => {
  it('formats 0 seconds as 00:00:00', () => {
    expect(formatDuration(0)).toBe('00:00:00');
  });

  it('formats 61 seconds as 00:01:01', () => {
    expect(formatDuration(61)).toBe('00:01:01');
  });

  it('formats 3661 seconds as 01:01:01', () => {
    expect(formatDuration(3661)).toBe('01:01:01');
  });

  it('formats 3600 seconds as 01:00:00', () => {
    expect(formatDuration(3600)).toBe('01:00:00');
  });

  it('formats 59 seconds as 00:00:59', () => {
    expect(formatDuration(59)).toBe('00:00:59');
  });

  it('formats large values correctly', () => {
    expect(formatDuration(86400)).toBe('24:00:00');
  });
});
