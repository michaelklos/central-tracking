import { vi } from 'vitest';

export function createMockIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    /**
     * `T` is the awaited return type of the registered handler. Defaulting to
     * `any` (not `unknown`) so existing tests that destructure the result —
     * `expect(task.id).toBeDefined()` — keep working without per-call type
     * arguments. The runtime call is still untyped under the hood; the
     * generic just lets the test reader assert via property access without
     * fighting strict mode at every call site.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional default per the comment above
    invoke: async <T = any>(channel: string, ...args: unknown[]): Promise<T> => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for channel: ${channel}`);
      return handler({}, ...args) as T;
    },
    handlers,
  };
}

export function createMockDialog() {
  return {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/test.csv' }),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [] }),
  };
}
