import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isAllowedAdoTransition, allowedAdoStatusTargets, isAdoReopen } from '../adoFsm';
import type { TaskStatus } from '../types';

describe('adoFsm', () => {
  it('allows a no-op transition from any status', () => {
    const statuses: TaskStatus[] = ['todo', 'in-progress', 'done', 'blocked'];
    for (const s of statuses) expect(isAllowedAdoTransition(s, s)).toBe(true);
  });

  it('allows todo → in-progress (timer start promotes a to-do)', () => {
    expect(isAllowedAdoTransition('todo', 'in-progress')).toBe(true);
  });

  it('refuses backward transitions that ADO has no workflow for', () => {
    expect(isAllowedAdoTransition('in-progress', 'todo')).toBe(false);
    expect(isAllowedAdoTransition('done', 'todo')).toBe(false);
  });

  it('treats blocked as a local-only state reachable from and to anything', () => {
    expect(isAllowedAdoTransition('in-progress', 'blocked')).toBe(true);
    expect(isAllowedAdoTransition('blocked', 'todo')).toBe(true);
  });

  it('includes the current status in the dropdown targets', () => {
    expect(allowedAdoStatusTargets('in-progress')).toEqual(['in-progress', 'done', 'blocked']);
  });

  it('flags done → in-progress as a reopen', () => {
    expect(isAdoReopen('done', 'in-progress')).toBe(true);
    expect(isAdoReopen('todo', 'in-progress')).toBe(false);
  });
});

// The ADO plugin is a separate esbuild-bundled workspace and cannot import
// from src/shared, so it keeps a hand-synced copy of the table. This guards
// the two from drifting apart — see the comment in plugins/ado/src/push-state.ts.
describe('plugin copy of the transition table', () => {
  it('matches the host table', () => {
    const src = readFileSync(
      join(__dirname, '../../../plugins/ado/src/push-state.ts'),
      'utf8',
    );
    const match = src.match(/const ALLOWED[^=]*=\s*(\{[\s\S]*?\n\});/);
    expect(match, 'could not find ALLOWED table in push-state.ts').toBeTruthy();

    const pluginTable = match![1];
    const statuses: TaskStatus[] = ['todo', 'in-progress', 'done', 'blocked'];
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to) continue;
        // The plugin lists each source status once, on its own line.
        const row = pluginTable
          .split('\n')
          .find((l) => new RegExp(`^\\s*'?${from}'?\\s*:`).test(l));
        expect(row, `plugin table is missing a row for "${from}"`).toBeTruthy();
        const listed = row!.includes(`'${to}'`);
        expect(listed, `"${from}" → "${to}" differs between host and plugin`).toBe(
          isAllowedAdoTransition(from, to),
        );
      }
    }
  });
});
