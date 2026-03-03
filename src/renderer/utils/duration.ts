/**
 * Parse a human-readable duration string into total seconds.
 * Supported formats:
 *   "1h30m" → 5400
 *   "45m"   → 2700
 *   "2h"    → 7200
 *   "1:30"  → 5400 (hours:minutes)
 *   "90"    → 5400 (minutes)
 * Returns null for invalid input.
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Format: "1h30m", "1h", "30m", "1h30m15s", etc.
  const hmPattern = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i;
  const hmMatch = trimmed.match(hmPattern);
  if (hmMatch && (hmMatch[1] || hmMatch[2] || hmMatch[3])) {
    const hours = parseInt(hmMatch[1] || '0', 10);
    const minutes = parseInt(hmMatch[2] || '0', 10);
    const seconds = parseInt(hmMatch[3] || '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Format: "1:30" (hours:minutes) or "1:30:00" (hours:minutes:seconds)
  const colonPattern = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/;
  const colonMatch = trimmed.match(colonPattern);
  if (colonMatch) {
    const hours = parseInt(colonMatch[1], 10);
    const minutes = parseInt(colonMatch[2], 10);
    const seconds = colonMatch[3] ? parseInt(colonMatch[3], 10) : 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Format: plain number (treated as minutes)
  const numPattern = /^(\d+)$/;
  const numMatch = trimmed.match(numPattern);
  if (numMatch) {
    return parseInt(numMatch[1], 10) * 60;
  }

  return null;
}

/**
 * Format seconds into a human-readable duration string.
 *   5400 → "1h 30m"
 *   60   → "1m"
 *   0    → "0m"
 */
export function formatDurationHuman(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}
