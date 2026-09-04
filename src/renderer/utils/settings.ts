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

/** A numeric setting, falling back whenever the stored text isn't a number. */
export function getNumberSetting(key: string, defaultValue: number): number {
  const parsed = parseInt(getStringSetting(key, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

/** How many tasks each list page loads. Configurable in the options menu. */
export const PAGE_SIZE_SETTING = 'ct-option-page-size';
export const DEFAULT_PAGE_SIZE = 50;

export function getPageSize(): number {
  return getNumberSetting(PAGE_SIZE_SETTING, DEFAULT_PAGE_SIZE);
}
