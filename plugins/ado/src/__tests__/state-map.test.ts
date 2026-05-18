import { describe, it, expect } from 'vitest';
import type { AdoConfig } from '../config';
import { effectiveStateMap, forwardStateMap, inverseStateMap } from '../state-map';

function makeConfig(overrides: Partial<AdoConfig> = {}): AdoConfig {
  return {
    pat: 'x',
    organization: 'org',
    project: 'proj',
    team: 'team',
    roundMinutes: 15,
    roundMode: 'nearest',
    workItemTypes: ['Task'],
    pullClosed: false,
    autoCommentOnTimePush: false,
    stateMap: null,
    ...overrides,
  };
}

describe('state-map', () => {
  it('falls back to the default state map when none configured', () => {
    const c = makeConfig();
    const m = effectiveStateMap(c);
    expect(m.todo.ado).toBe('New');
    expect(m['in-progress'].ado).toBe('Active');
    expect(m.done.ado).toBe('Closed');
  });

  it('inverseStateMap returns ct status for any altIn match', () => {
    const c = makeConfig();
    expect(inverseStateMap(c, 'New')).toBe('todo');
    expect(inverseStateMap(c, 'Active')).toBe('in-progress');
    expect(inverseStateMap(c, 'Committed')).toBe('in-progress');
    expect(inverseStateMap(c, 'Closed')).toBe('done');
    expect(inverseStateMap(c, 'Resolved')).toBe('done');
  });

  it('inverseStateMap returns null for unmapped states', () => {
    const c = makeConfig();
    expect(inverseStateMap(c, 'Frozen')).toBeNull();
    expect(inverseStateMap(c, '')).toBeNull();
  });

  it('forwardStateMap returns the ADO state for a ct status', () => {
    const c = makeConfig();
    expect(forwardStateMap(c, 'todo')).toBe('New');
    expect(forwardStateMap(c, 'in-progress')).toBe('Active');
    expect(forwardStateMap(c, 'done')).toBe('Closed');
  });

  it('forwardStateMap returns null when ct status has no entry (e.g. blocked)', () => {
    const c = makeConfig();
    expect(forwardStateMap(c, 'blocked')).toBeNull();
  });

  it('respects custom user state-map override', () => {
    const c = makeConfig({
      stateMap: {
        todo: { ado: 'Proposed', altIn: ['Proposed'] },
        'in-progress': { ado: 'Working', altIn: ['Working'] },
        done: { ado: 'Shipped', altIn: ['Shipped'] },
      },
    });
    expect(forwardStateMap(c, 'todo')).toBe('Proposed');
    expect(inverseStateMap(c, 'Shipped')).toBe('done');
    expect(inverseStateMap(c, 'New')).toBeNull(); // not in custom map
  });
});
