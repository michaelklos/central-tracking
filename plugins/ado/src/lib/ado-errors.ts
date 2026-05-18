/**
 * Shared ADO HTTP error helpers used across push-time / push-state /
 * push-comments. Kept tiny on purpose — the only branches anyone needs are
 * "is this the rev-conflict that warrants a refetch+retry?" and "how do I
 * stringify this for a warning line?".
 */
import type { AxiosError } from 'axios';

export function isConflict(err: unknown): boolean {
  const ax = err as AxiosError;
  return ax?.response?.status === 409;
}

export function isWorkflowRejection(err: unknown): boolean {
  const ax = err as AxiosError;
  return ax?.response?.status === 400;
}

export function describeError(err: unknown): string {
  const ax = err as AxiosError;
  if (ax?.response) return `HTTP ${ax.response.status} ${JSON.stringify(ax.response.data)}`;
  return err instanceof Error ? err.message : String(err);
}
