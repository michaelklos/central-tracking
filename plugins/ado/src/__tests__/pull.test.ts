import { describe, it, expect, vi } from 'vitest';
import type { AdoConfig } from '../config';
import { _internals, refresh } from '../pull';
import type { AdoWorkItem, CtTask } from '../types';
import type { AdoClient } from '../ado-client';
import type { CtClient } from '../ct-client';
import TurndownService from 'turndown';

const { buildWiql, buildTaskInput } = _internals;

function makeConfig(overrides: Partial<AdoConfig> = {}): AdoConfig {
  return {
    pat: 'x',
    organization: 'contoso',
    project: 'WebApp',
    team: 'WebApp Team',
    roundMinutes: 15,
    roundMode: 'nearest',
    workItemTypes: ['User Story', 'Bug', 'Task'],
    pullClosed: false,
    autoCommentOnTimePush: false,
    stateMap: null,
    ...overrides,
  };
}

function makeWorkItem(overrides: Partial<AdoWorkItem['fields']> & { id?: number } = {}): AdoWorkItem {
  const { id = 1234, ...fields } = overrides;
  return {
    id,
    rev: 1,
    fields: {
      'System.Id': id,
      'System.Title': 'Sample item',
      'System.State': 'New',
      'System.WorkItemType': 'Task',
      ...fields,
    },
    url: `https://dev.azure.com/contoso/WebApp/_apis/wit/workItems/${id}`,
  };
}

describe('buildWiql', () => {
  it('quotes iteration paths and types', () => {
    const w = buildWiql(`Project\\Sprint 1`, ['User Story', 'Task'], false);
    expect(w).toContain(`[System.IterationPath] = 'Project\\Sprint 1'`);
    expect(w).toContain(`'User Story', 'Task'`);
  });

  it('excludes Closed when pullClosed=false', () => {
    const w = buildWiql('X', ['Task'], false);
    expect(w).toContain(`[System.State] <> 'Closed'`);
  });

  it('includes Closed when pullClosed=true', () => {
    const w = buildWiql('X', ['Task'], true);
    expect(w).not.toContain(`[System.State] <> 'Closed'`);
  });

  it('escapes single quotes in iteration path', () => {
    const w = buildWiql(`Foo's Sprint`, ['Task'], false);
    expect(w).toContain(`'Foo''s Sprint'`);
  });
});

describe('buildTaskInput', () => {
  const turndown = new TurndownService();

  it('produces pluginId=ado, title with #id - title, mirror fields populated', () => {
    const config = makeConfig();
    const unmapped: { id: number; state: string }[] = [];
    const input = buildTaskInput(
      config,
      turndown,
      makeWorkItem({
        id: 42,
        'System.Title': 'Build the widget',
        'System.State': 'Active',
        'Microsoft.VSTS.Scheduling.CompletedWork': 3.5,
        'System.Description': '<p>hello <b>world</b></p>',
      }),
      unmapped,
    );
    expect(input.pluginId).toBe('ado');
    expect(input.externalId).toBe('42');
    expect(input.title).toBe('#42 - Build the widget');
    expect(input.status).toBe('in-progress');
    expect(input.externalState).toBe('Active');
    expect(input.externalCompletedHours).toBe(3.5);
    expect(input.externalUrl).toContain('/_workitems/edit/42');
    expect(input.notes).toContain('hello');
    expect(input.notes).toContain('world');
    expect(unmapped).toHaveLength(0);
  });

  it('defaults status to todo and records an unmapped warning for unknown states', () => {
    const config = makeConfig();
    const unmapped: { id: number; state: string }[] = [];
    const input = buildTaskInput(
      config,
      turndown,
      makeWorkItem({ id: 7, 'System.State': 'Bikeshedding' }),
      unmapped,
    );
    expect(input.status).toBe('todo');
    expect(unmapped).toEqual([{ id: 7, state: 'Bikeshedding' }]);
  });

  it('treats missing CompletedWork as 0', () => {
    const config = makeConfig();
    const input = buildTaskInput(config, turndown, makeWorkItem({ id: 1 }), []);
    expect(input.externalCompletedHours).toBe(0);
  });

  it('handles empty/missing description as empty notes', () => {
    const config = makeConfig();
    const input = buildTaskInput(config, turndown, makeWorkItem({ id: 2 }), []);
    expect(input.notes).toBe('');
  });
});

describe('refresh — full-mirror gate', () => {
  function makeCtTask(overrides: Partial<CtTask> = {}): CtTask {
    return {
      id: 'ct-1',
      title: '#100 - Sample',
      status: 'todo',
      source: 'plugin',
      pluginId: 'ado',
      externalId: '100',
      externalUrl: null,
      externalState: 'New',
      externalCompletedHours: 0,
      externalRefreshedAt: null,
      stateDirty: false,
      notes: '',
      unreportedTimeSeconds: 0,
      hasUnreportedTime: false,
      ...overrides,
    };
  }

  function makeCt(task: CtTask | null): CtClient {
    return {
      getTaskById: vi.fn().mockResolvedValue(task),
      // The fail-fast tests below never reach these; stub just enough so the
      // type system is happy.
      upsertExternalTask: vi.fn(),
      upsertExternalComment: vi.fn(),
    } as unknown as CtClient;
  }

  const adoStub = {
    getWorkItem: vi.fn(),
    getWorkItemComments: vi.fn(),
  } as unknown as AdoClient;

  it('rejects link-only ADO tasks (pluginId=ado, source != plugin)', async () => {
    const ct = makeCt(makeCtTask({ source: 'ad-hoc' }));
    await expect(refresh(adoStub, ct, makeConfig(), 'ct-1')).rejects.toThrow(
      /not an ado full-mirror task.*source=ad-hoc/,
    );
  });

  it('rejects tasks owned by a different plugin', async () => {
    const ct = makeCt(makeCtTask({ pluginId: 'jira', source: 'plugin' }));
    await expect(refresh(adoStub, ct, makeConfig(), 'ct-1')).rejects.toThrow(
      /pluginId=jira/,
    );
  });

  it('rejects tasks with no externalId', async () => {
    const ct = makeCt(makeCtTask({ externalId: null }));
    await expect(refresh(adoStub, ct, makeConfig(), 'ct-1')).rejects.toThrow(
      /not an ado full-mirror task/,
    );
  });

  it('throws when the ct task does not exist', async () => {
    const ct = makeCt(null);
    await expect(refresh(adoStub, ct, makeConfig(), 'missing')).rejects.toThrow(
      /not found/,
    );
  });
});
