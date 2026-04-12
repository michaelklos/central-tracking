import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  generateToken,
  writeServerFile,
  readServerFile,
  removeServerFile,
  isValidToken,
  isValidHost,
} from '../auth';

describe('Auth', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-auth-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateToken', () => {
    it('returns a UUID v4 string', () => {
      const token = generateToken();
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 10 }, () => generateToken()));
      expect(tokens.size).toBe(10);
    });
  });

  describe('writeServerFile / readServerFile', () => {
    it('writes and reads server info', () => {
      const info = { port: 19532, token: 'test-token', pid: 12345 };
      writeServerFile(tmpDir, info);
      const read = readServerFile(tmpDir);
      expect(read).toEqual(info);
    });

    it('creates file with restricted permissions', () => {
      writeServerFile(tmpDir, { port: 19532, token: 'test', pid: 1 });
      const filePath = path.join(tmpDir, 'ct-server.json');
      const stats = fs.statSync(filePath);
      // Owner read/write only (0o600 = 384 decimal)
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe('readServerFile', () => {
    it('returns null when file does not exist', () => {
      const result = readServerFile(tmpDir);
      expect(result).toBeNull();
    });
  });

  describe('removeServerFile', () => {
    it('removes the file', () => {
      writeServerFile(tmpDir, { port: 19532, token: 'test', pid: 1 });
      removeServerFile(tmpDir);
      expect(readServerFile(tmpDir)).toBeNull();
    });

    it('does not throw when file does not exist', () => {
      expect(() => removeServerFile(tmpDir)).not.toThrow();
    });
  });

  describe('isValidToken', () => {
    it('returns true for valid Bearer token', () => {
      const req = { headers: { authorization: 'Bearer my-secret-token' } };
      expect(isValidToken(req, 'my-secret-token')).toBe(true);
    });

    it('returns false for wrong token', () => {
      const req = { headers: { authorization: 'Bearer wrong-token' } };
      expect(isValidToken(req, 'my-secret-token')).toBe(false);
    });

    it('returns false for missing header', () => {
      const req = { headers: {} };
      expect(isValidToken(req, 'my-secret-token')).toBe(false);
    });

    it('returns false for non-Bearer scheme', () => {
      const req = { headers: { authorization: 'Basic abc123' } };
      expect(isValidToken(req, 'abc123')).toBe(false);
    });
  });

  describe('isValidHost', () => {
    it('accepts 127.0.0.1:port', () => {
      const req = { headers: { host: '127.0.0.1:19532' } };
      expect(isValidHost(req, 19532)).toBe(true);
    });

    it('accepts localhost:port', () => {
      const req = { headers: { host: 'localhost:19532' } };
      expect(isValidHost(req, 19532)).toBe(true);
    });

    it('rejects unknown host (DNS rebinding)', () => {
      const req = { headers: { host: 'evil.com:19532' } };
      expect(isValidHost(req, 19532)).toBe(false);
    });

    it('rejects missing host header', () => {
      const req = { headers: {} };
      expect(isValidHost(req, 19532)).toBe(false);
    });

    it('rejects wrong port', () => {
      const req = { headers: { host: '127.0.0.1:9999' } };
      expect(isValidHost(req, 19532)).toBe(false);
    });
  });
});
