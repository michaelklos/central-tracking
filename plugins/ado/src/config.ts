import { CtClient } from './ct-client';

export interface AdoConfig {
  pat: string;
  organization: string;
  project: string;
  team: string | null;
  roundMinutes: number;
  roundMode: 'nearest' | 'up' | 'down';
  workItemTypes: string[];
  pullClosed: boolean;
  autoCommentOnTimePush: boolean;
  /** When false, push-time skips the post-push markTaskReported call so the
   *  user controls reported state manually. Default true. Mirrors the
   *  per-plugin `tracks-reported` toggle that the renderer reads to suppress
   *  unreported badges and batch actions. */
  tracksReported: boolean;
  stateMap: Record<string, { ado: string; altIn: string[] }> | null;
}

const REQUIRED_KEYS = ['pat', 'organization', 'project'] as const;

function toMap(entries: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) out[e.key] = e.value;
  return out;
}

export async function loadConfig(client: CtClient): Promise<AdoConfig> {
  const entries = await client.listPluginConfig();
  const map = toMap(entries);

  const missing = REQUIRED_KEYS.filter((k) => !map[k]);
  if (missing.length) {
    throw new Error(
      `Missing required ado config keys: ${missing.join(', ')}. ` +
        `Set via: ct plugin config set ado <key> <value>`,
    );
  }

  let stateMap: AdoConfig['stateMap'] = null;
  if (map['state-map']) {
    try {
      stateMap = JSON.parse(map['state-map']);
    } catch (err) {
      throw new Error(`Invalid JSON in ado state-map: ${(err as Error).message}`);
    }
  }

  return {
    pat: map.pat,
    organization: map.organization,
    project: map.project,
    team: map.team ?? null,
    roundMinutes: map['round-minutes'] ? Number(map['round-minutes']) : 15,
    roundMode: (map['round-mode'] as AdoConfig['roundMode']) ?? 'nearest',
    workItemTypes: map['work-item-types']
      ? map['work-item-types'].split(',').map((s) => s.trim()).filter(Boolean)
      : ['User Story', 'Bug', 'Task'],
    pullClosed: map['pull-closed'] === 'true',
    autoCommentOnTimePush: map['auto-comment-on-time-push'] === 'true',
    // Default true so the historical push behaviour (auto-mark reported on
    // success) keeps working unless the user explicitly opts out.
    tracksReported: map['tracks-reported'] !== 'false',
    stateMap,
  };
}
