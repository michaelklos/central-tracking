import { CtClient, loadConfig as sharedLoadConfig } from '@central-tracking/plugin-client';
import type { AdoStateMap } from './types';

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
  stateMap: AdoStateMap | null;
}

const REQUIRED_KEYS = ['pat', 'organization', 'project'] as const;

export async function loadConfig(client: CtClient): Promise<AdoConfig> {
  return sharedLoadConfig(client, REQUIRED_KEYS, (map): AdoConfig => {
    let stateMap: AdoConfig['stateMap'] = null;
    if (map['state-map']) {
      try {
        stateMap = JSON.parse(map['state-map']) as AdoStateMap;
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
      tracksReported: map['tracks-reported'] !== 'false',
      stateMap,
    };
  });
}
