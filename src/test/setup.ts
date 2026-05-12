import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { createMockApi } from './mocks/api';

// Provide a working localStorage stub for test environments that don't have one
if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
  const store: Record<string, string> = {};
  // Non-enumerable methods + enumerable stored keys (mirrors the Storage interface)
  const localStorageMock = Object.create(null);
  const define = (key: string, value: unknown, enumerable = false) =>
    Object.defineProperty(localStorageMock, key, { value, writable: true, configurable: true, enumerable });
  define('getItem', (key: string) => (key in store ? store[key] : null));
  define('setItem', (key: string, value: string) => {
    store[key] = String(value);
    define(key, store[key], true);
  });
  define('removeItem', (key: string) => {
    delete store[key];
    delete localStorageMock[key];
  });
  define('clear', () => {
    Object.keys(store).forEach((k) => { delete store[k]; delete localStorageMock[k]; });
  });
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
}

// Set up window.api mock before each test
beforeEach(() => {
  (window as Record<string, unknown>).api = createMockApi();
});
