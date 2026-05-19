/**
 * App-wide secret storage convention. Wraps Electron `safeStorage` (which
 * delegates to the OS keychain: macOS Keychain, Windows DPAPI, libsecret /
 * kwallet on Linux) and produces a self-describing ciphertext string suitable
 * for storage in any TEXT column.
 *
 * Stored format: `enc:v1:<base64-of-encrypted-bytes>`.
 *
 * - `decrypt()` accepts a sentinel-prefixed value (decrypts) OR a raw string
 *   (passes through unchanged). That keeps the helper idempotent and lets
 *   callers migrate plaintext rows incrementally without a schema change.
 * - `encrypt()` throws `DomainError('NO_KEYRING', …)` when the platform
 *   keyring is not available. Callers decide whether to surface the error
 *   or honour an opt-in plaintext fallback (`--allow-plaintext`).
 *
 * Initialisation: `safeStorage` is only usable after `app.whenReady()`
 * resolves in the main process. This module does NOT call into Electron at
 * import time — every public function checks availability on each call —
 * so it's safe to import from anywhere in main.
 */
import { safeStorage } from 'electron';
import { DomainError } from './errors';

export const SECRET_SENTINEL = 'enc:v1:';

/** Returns true when safeStorage can encrypt on this platform. */
export function isAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    // Module imported before app.whenReady(), or in a non-Electron context.
    return false;
  }
}

/** Returns true when `value` is a sentinel-tagged ciphertext. */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(SECRET_SENTINEL);
}

/**
 * Encrypt `plaintext` with the OS keychain and return a sentinel-tagged
 * string. Throws `DomainError('NO_KEYRING', …)` when the keyring is not
 * available — caller chooses whether to honour an --allow-plaintext flag
 * or surface the error.
 */
export function encrypt(plaintext: string): string {
  if (!isAvailable()) {
    throw new DomainError(
      'NO_KEYRING',
      'OS keyring is not available. ' +
        'macOS / Windows: Keychain / DPAPI should always be available — re-check after `app.whenReady()`. ' +
        'Linux: install libsecret-1-0 + gnome-keyring (GNOME) or kwalletd (KDE) and ensure a session keyring is unlocked. ' +
        'To proceed without encryption (NOT recommended), re-run with --allow-plaintext.',
    );
  }
  const buf = safeStorage.encryptString(plaintext);
  return SECRET_SENTINEL + buf.toString('base64');
}

/**
 * Decrypt a sentinel-tagged ciphertext. Plain strings (no sentinel) are
 * returned unchanged so this is safe to call on every read, including legacy
 * plaintext rows.
 */
export function decrypt(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  if (!isAvailable()) {
    throw new DomainError(
      'NO_KEYRING',
      'Cannot decrypt: OS keyring is unavailable. ' +
        'On Linux, install libsecret-1-0 + gnome-keyring or kwalletd and unlock the session keyring before launching the app.',
    );
  }
  const b64 = stored.slice(SECRET_SENTINEL.length);
  const buf = Buffer.from(b64, 'base64');
  return safeStorage.decryptString(buf);
}
