/**
 * Test harness for CLI command handlers.
 *
 * - Mocks `../../client` so `discoverServer()` returns a fake ServerInfo and
 *   `apiRequest()` is routed through an in-test registry.
 * - Captures stdout/stderr.
 * - Replaces `process.exit` with a sentinel-throwing stub so tests can assert
 *   the exit code without killing the test runner.
 *
 * Usage:
 *   const { stdout, stderr, exitCode, calls } = await runCli(
 *     registerTaskCommands,
 *     ['task', 'list', '--json'],
 *     { responses: { 'tasks/getActive': () => ({ items: [], total: 0, hasMore: false }) } },
 *   );
 */
import { vi } from 'vitest';
import yargs, { type Argv } from 'yargs';

vi.mock('../../client', () => ({
  discoverServer: vi.fn(() => ({ port: 5555, token: 'test-token', pid: process.pid })),
  apiRequest: vi.fn(),
}));

import { apiRequest, discoverServer } from '../../client';

export interface RecordedCall {
  endpoint: string;
  args: unknown[];
}

type Response = unknown | ((args: unknown[]) => unknown | Promise<unknown>);

export interface RunCliOptions {
  /** Map of endpoint -> response value or thunk. Unmapped endpoints throw. */
  responses?: Record<string, Response>;
  /** Override discoverServer to throw (simulates app not running). */
  serverDown?: boolean;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  calls: RecordedCall[];
}

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

export async function runCli(
  register: (y: Argv) => Argv,
  argv: string[],
  opts: RunCliOptions = {},
): Promise<RunCliResult> {
  const calls: RecordedCall[] = [];
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = null;

  // Wire request mock.
  const reqMock = apiRequest as unknown as ReturnType<typeof vi.fn>;
  reqMock.mockReset();
  reqMock.mockImplementation(async (_server: unknown, endpoint: string, args: unknown[] = []) => {
    calls.push({ endpoint, args });
    const responses = opts.responses ?? {};
    if (!Object.prototype.hasOwnProperty.call(responses, endpoint)) {
      throw new Error(`Unmocked endpoint: ${endpoint}`);
    }
    const resp = responses[endpoint];
    return typeof resp === 'function' ? await (resp as (a: unknown[]) => unknown)(args) : resp;
  });

  const discoverMock = discoverServer as unknown as ReturnType<typeof vi.fn>;
  discoverMock.mockReset();
  if (opts.serverDown) {
    discoverMock.mockImplementation(() => {
      throw new Error('Central Tracking is not running. Start the app first.');
    });
  } else {
    discoverMock.mockImplementation(() => ({ port: 5555, token: 'test-token', pid: process.pid }));
  }

  // Patch IO.
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origExit = process.exit;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new ExitError(exitCode);
  }) as typeof process.exit;

  try {
    const cli = yargs([])
      .scriptName('ct')
      .option('json', { type: 'boolean', global: true, default: false })
      .option('debug', { type: 'boolean', global: true, default: false })
      .option('timeout', { type: 'number', global: true, default: 10 })
      .exitProcess(false)
      .fail((msg, err) => {
        if (err) {
          stderr += `${err.message}\n`;
        } else if (msg) {
          stderr += `${msg}\n`;
        }
        exitCode = 1;
        throw new ExitError(1);
      });
    register(cli);
    await cli.parseAsync(argv);
  } catch (err) {
    if (!(err instanceof ExitError)) throw err;
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    process.exit = origExit;
  }

  return { stdout, stderr, exitCode, calls };
}
