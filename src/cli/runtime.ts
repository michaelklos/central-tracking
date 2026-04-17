import { discoverServer, apiRequest, type ServerInfo, type RequestOptions } from './client';
import { createApiClient, type ApiClient } from './api';

export interface GlobalArgv {
  json: boolean;
  debug: boolean;
  timeout: number;
}

export interface CommandContext {
  argv: GlobalArgv;
  server: ServerInfo;
  client: ApiClient;
  /** Raw HTTP call for operations not covered by the typed client. */
  request<T = unknown>(endpoint: string, args?: unknown[]): Promise<T>;
}

function argvToRequestOptions(argv: GlobalArgv): RequestOptions {
  return {
    timeoutMs: Math.max(1, argv.timeout) * 1000,
    debug: argv.debug,
  };
}

/**
 * Wraps a command handler with:
 * - server discovery (single call, reused for every request in the handler)
 * - request options derived from --timeout and --debug
 * - typed + raw HTTP access
 * - uniform error handling (message to stderr, exit 1)
 */
export async function runCommand<T>(
  argv: unknown,
  fn: (ctx: CommandContext) => Promise<T>,
): Promise<T | undefined> {
  const g = argv as GlobalArgv;
  let server: ServerInfo;
  try {
    server = discoverServer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }

  const opts = argvToRequestOptions(g);
  const request = <R>(endpoint: string, args: unknown[] = []): Promise<R> =>
    apiRequest<R>(server, endpoint, args, opts);
  const client = createApiClient(request);

  try {
    return await fn({ argv: g, server, client, request });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

/**
 * Uniform output helper: prints JSON when --json is set, otherwise the
 * human-formatted text produced by the caller.
 */
export function output<T>(
  argv: unknown,
  data: T,
  humanFormatter: (data: T) => string,
): void {
  const json = (argv as { json?: boolean }).json === true;
  if (json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${humanFormatter(data)}\n`);
  }
}

/**
 * Print a plain message to stdout (newline-terminated). Use for single-line
 * confirmations like "Deleted task …".
 */
export function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Print an error message to stderr and exit 1. Use for user-facing validation
 * errors (e.g., required flag missing) — server errors are surfaced by
 * runCommand's catch.
 */
export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
