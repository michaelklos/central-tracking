import type { TimeEntry } from '../../shared/types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a time entry's start/end range.
 * Checks:
 * - end must be after start
 * - duration must be > 0
 * - must not overlap with existing entries (unless excludeId matches)
 */
export function validateTimeEntry(
  startTime: string,
  endTime: string,
  existingEntries: TimeEntry[],
  excludeId?: string
): ValidationResult {
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  if (isNaN(startMs) || isNaN(endMs)) {
    return { valid: false, error: 'Invalid date format' };
  }

  if (endMs <= startMs) {
    return { valid: false, error: 'End time must be after start time' };
  }

  const durationMs = endMs - startMs;
  if (durationMs === 0) {
    return { valid: false, error: 'Duration must be greater than zero' };
  }

  // Check for overlaps with existing entries
  for (const entry of existingEntries) {
    if (excludeId && entry.id === excludeId) continue;
    if (!entry.endTime) continue; // Skip running entries

    const eStartMs = new Date(entry.startTime).getTime();
    const eEndMs = new Date(entry.endTime).getTime();

    // Overlap if: start < existing end AND end > existing start
    if (startMs < eEndMs && endMs > eStartMs) {
      return { valid: false, error: 'Overlaps with an existing time entry' };
    }
  }

  return { valid: true };
}
