import type { AdoConfig } from './config';
import type { AdoStateMap, CtTaskStatus } from './types';
import { ADO_DEFAULT_STATE_MAP } from './types';

const CT_STATUSES: readonly CtTaskStatus[] = ['todo', 'in-progress', 'done', 'blocked'];

function isCtStatus(s: string): s is CtTaskStatus {
  return (CT_STATUSES as readonly string[]).includes(s);
}

export function effectiveStateMap(config: AdoConfig): AdoStateMap {
  return config.stateMap ?? ADO_DEFAULT_STATE_MAP;
}

/**
 * Map an ADO state name back to a ct status via the `altIn` lists.
 * Returns `null` if no entry matches — caller decides the fallback.
 */
export function inverseStateMap(
  config: AdoConfig,
  adoState: string,
): CtTaskStatus | null {
  const map = effectiveStateMap(config);
  for (const [ctStatus, def] of Object.entries(map)) {
    if (def.altIn.includes(adoState) && isCtStatus(ctStatus)) {
      return ctStatus;
    }
  }
  return null;
}

/**
 * Map a ct status to its ADO equivalent (the `ado` field in the map).
 * Returns `null` if the ct status has no entry — caller must handle.
 */
export function forwardStateMap(
  config: AdoConfig,
  ctStatus: CtTaskStatus,
): string | null {
  const map = effectiveStateMap(config);
  return map[ctStatus]?.ado ?? null;
}
