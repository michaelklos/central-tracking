/**
 * Reading persisted user settings. They live in localStorage under
 * `ct-option-*` keys, written by OptionsMenu.
 */

export function getStringSetting(key: string, defaultValue: string): string {
  try {
    return localStorage.getItem(key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * A numeric setting, falling back whenever the stored text isn't a whole
 * positive number. `Number` rather than `parseInt`, which would read "75abc"
 * as 75 and silently accept a corrupted value.
 */
export function getNumberSetting(key: string, defaultValue: number): number {
  const stored = getStringSetting(key, '').trim();
  if (stored === '') return defaultValue;
  const parsed = Number(stored);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

/** How many tasks each list page loads. Configurable in the options menu. */
export const PAGE_SIZE_SETTING = 'ct-option-page-size';
export const DEFAULT_PAGE_SIZE = 50;
export const MIN_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 500;

/**
 * Clamped to the same bounds the settings input advertises. The `min`/`max`
 * attributes don't stop a typed value in every browser, and nothing validates
 * on write, so a stray `1` would otherwise mean one task per page.
 */
export function getPageSize(): number {
  const stored = getNumberSetting(PAGE_SIZE_SETTING, DEFAULT_PAGE_SIZE);
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, stored));
}
