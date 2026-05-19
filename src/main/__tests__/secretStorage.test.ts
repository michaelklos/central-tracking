import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  electronMockFactory,
  mockSafeStorage,
  resetMockSafeStorage,
  setSafeStorageAvailable,
} from '../../test/mocks/safeStorage';

vi.mock('electron', () => electronMockFactory());

// Import AFTER vi.mock so the module picks up the mocked electron.
import { SECRET_SENTINEL, isAvailable, isEncrypted, encrypt, decrypt } from '../secretStorage';
import { DomainError } from '../errors';

describe('secretStorage', () => {
  beforeEach(() => {
    resetMockSafeStorage();
  });

  describe('isAvailable', () => {
    it('returns true when the OS keyring is available', () => {
      setSafeStorageAvailable(true);
      expect(isAvailable()).toBe(true);
    });

    it('returns false when the OS keyring is not available', () => {
      setSafeStorageAvailable(false);
      expect(isAvailable()).toBe(false);
    });
  });

  describe('isEncrypted', () => {
    it('detects the sentinel prefix', () => {
      expect(isEncrypted('enc:v1:abc')).toBe(true);
    });

    it('returns false for plaintext / unrelated strings', () => {
      expect(isEncrypted('plain-token')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted('enc:v0:legacy')).toBe(false);
    });
  });

  describe('encrypt', () => {
    it('round-trips through decrypt', () => {
      const enc = encrypt('hello world');
      expect(enc.startsWith(SECRET_SENTINEL)).toBe(true);
      expect(enc).not.toContain('hello world');
      expect(decrypt(enc)).toBe('hello world');
    });

    it('throws DomainError(NO_KEYRING) when keyring unavailable', () => {
      setSafeStorageAvailable(false);
      expect(() => encrypt('secret')).toThrow(DomainError);
      try {
        encrypt('secret');
      } catch (err) {
        expect((err as DomainError).code).toBe('NO_KEYRING');
      }
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    });

    it('handles unicode + empty strings', () => {
      expect(decrypt(encrypt(''))).toBe('');
      expect(decrypt(encrypt('üñîçødé 🔐'))).toBe('üñîçødé 🔐');
    });
  });

  describe('decrypt', () => {
    it('passes raw plaintext through unchanged (legacy rows)', () => {
      expect(decrypt('plain-token-value')).toBe('plain-token-value');
      expect(mockSafeStorage.decryptString).not.toHaveBeenCalled();
    });

    it('throws DomainError(NO_KEYRING) when sentinel value but keyring unavailable', () => {
      const enc = encrypt('x');
      setSafeStorageAvailable(false);
      expect(() => decrypt(enc)).toThrow(DomainError);
      try {
        decrypt(enc);
      } catch (err) {
        expect((err as DomainError).code).toBe('NO_KEYRING');
      }
    });
  });
});
