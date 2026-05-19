import { vi } from 'vitest';

/**
 * In-memory stub for Electron `safeStorage`. Use with `vi.mock('electron')`
 * at the top of test files that exercise `src/main/secretStorage.ts` or any
 * downstream caller (e.g. `pluginHandlers` with --secret flow).
 *
 * Encryption here is a trivial XOR-with-static-key — sufficient to verify
 * that values get transformed before storage and survive a round-trip, while
 * being entirely synchronous and dependency-free.
 *
 * Switch the "available" flag at runtime with `setSafeStorageAvailable(bool)`
 * to exercise the NO_KEYRING branches.
 */
export const MOCK_XOR_KEY = 0x5a;

let available = true;

export function setSafeStorageAvailable(value: boolean): void {
  available = value;
}

function xor(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ MOCK_XOR_KEY;
  return out;
}

export const mockSafeStorage = {
  isEncryptionAvailable: vi.fn(() => available),
  encryptString: vi.fn((plaintext: string) => xor(Buffer.from(plaintext, 'utf8'))),
  decryptString: vi.fn((buf: Buffer) => xor(buf).toString('utf8')),
};

/**
 * Call inside `vi.mock('electron', () => electronMockFactory())` to get a
 * minimal Electron-module stub backed by this safeStorage.
 */
export function electronMockFactory() {
  return {
    safeStorage: mockSafeStorage,
  };
}

/** Reset between tests. */
export function resetMockSafeStorage(): void {
  available = true;
  mockSafeStorage.isEncryptionAvailable.mockClear();
  mockSafeStorage.encryptString.mockClear();
  mockSafeStorage.decryptString.mockClear();
}
