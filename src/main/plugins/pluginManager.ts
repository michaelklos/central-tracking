import type { Database } from '../database/database';
import type { SourcePlugin } from './pluginInterface';
import type { PluginInfo, PluginSyncResult, Task } from '../../shared/types';
import { AdoPlugin } from './adoPlugin';
import { JiraPlugin } from './jiraPlugin';

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  source: string;
  external_id: string | null;
  plugin_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class PluginManager {
  private plugins: Map<string, SourcePlugin> = new Map();
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.registerBuiltInPlugins();
  }

  private registerBuiltInPlugins(): void {
    const ado = new AdoPlugin();
    const jira = new JiraPlugin();

    this.plugins.set(ado.id, ado);
    this.plugins.set(jira.id, jira);

    // Load saved config for each plugin
    for (const [pluginId, plugin] of this.plugins) {
      const configRows = this.db.instance
        .prepare('SELECT key, value FROM plugin_config WHERE plugin_id = ?')
        .all(pluginId) as { key: string; value: string }[];

      if (configRows.length > 0) {
        const config: Record<string, string> = {};
        for (const row of configRows) {
          config[row.key] = row.value;
        }
        plugin.initialize(config).catch(() => {
          // Config may be invalid; plugin will report not connected
        });
      }
    }
  }

  registerPlugin(plugin: SourcePlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  listPlugins(): PluginInfo[] {
    const result: PluginInfo[] = [];

    for (const plugin of this.plugins.values()) {
      const configRows = this.db.instance
        .prepare('SELECT key, value FROM plugin_config WHERE plugin_id = ?')
        .all(plugin.id) as { key: string; value: string }[];

      result.push({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        enabled: configRows.length > 0,
        configFields: plugin.configFields,
      });
    }

    return result;
  }

  async syncPlugin(pluginId: string): Promise<PluginSyncResult> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return { created: 0, updated: 0, errors: [`Plugin "${pluginId}" not found`] };
    }

    const taskRows = this.db.instance
      .prepare('SELECT * FROM tasks WHERE plugin_id = ?')
      .all(pluginId) as TaskRow[];

    const existingTasks: Task[] = taskRows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status as Task['status'],
      source: row.source as Task['source'],
      externalId: row.external_id,
      pluginId: row.plugin_id,
      sortOrder: row.sort_order,
      totalTimeSeconds: 0,
      todayTimeSeconds: 0,
      categoryIds: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return plugin.sync(existingTasks);
  }
}
