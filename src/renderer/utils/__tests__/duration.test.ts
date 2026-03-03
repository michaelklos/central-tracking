import { describe, it, expect } from 'vitest';
import { parseDuration, formatDurationHuman } from '../duration';

describe('parseDuration', () => {
  it('parses "1h30m" → 5400', () => {
    expect(parseDuration('1h30m')).toBe(5400);
  });

  it('parses "45m" → 2700', () => {
    expect(parseDuration('45m')).toBe(2700);
  });

  it('parses "2h" → 7200', () => {
    expect(parseDuration('2h')).toBe(7200);
  });

  it('parses "1:30" → 5400', () => {
    expect(parseDuration('1:30')).toBe(5400);
  });

  it('parses "90" as minutes → 5400', () => {
    expect(parseDuration('90')).toBe(5400);
  });

  it('returns null for "invalid"', () => {
    expect(parseDuration('invalid')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDuration('')).toBeNull();
  });

  it('parses "1:30:00" → 5400', () => {
    expect(parseDuration('1:30:00')).toBe(5400);
  });
});

describe('formatDurationHuman', () => {
  it('formats 5400 → "1h 30m"', () => {
    expect(formatDurationHuman(5400)).toBe('1h 30m');
  });

  it('formats 60 → "1m"', () => {
    expect(formatDurationHuman(60)).toBe('1m');
  });

  it('formats 0 → "0m"', () => {
    expect(formatDurationHuman(0)).toBe('0m');
  });

  it('formats 7200 → "2h"', () => {
    expect(formatDurationHuman(7200)).toBe('2h');
  });
});
