import type { PluginConfigField, PluginSyncResult, Task, Comment } from '../../shared/types';
import type { ExternalTask, SourcePlugin } from './pluginInterface';

/**
 * Azure DevOps plugin scaffold.
 *
 * Connects to ADO via REST API to pull work items assigned to the user
 * and push comments/time/status updates back.
 *
 * Configuration required:
 * - organizationUrl: e.g. https://dev.azure.com/myorg
 * - project: ADO project name
 * - pat: Personal Access Token with work item read/write scope
 * - query: Optional WIQL query override
 */
export class AdoPlugin implements SourcePlugin {
  readonly id = 'azure-devops';
  readonly name = 'Azure DevOps';
  readonly description = 'Sync work items from Azure DevOps (ADO)';

  readonly configFields: PluginConfigField[] = [
    { key: 'organizationUrl', label: 'Organization URL', type: 'url', required: true },
    { key: 'project', label: 'Project Name', type: 'string', required: true },
    { key: 'pat', label: 'Personal Access Token', type: 'password', required: true },
    { key: 'query', label: 'WIQL Query (optional)', type: 'string', required: false },
  ];

  private config: Record<string, string> = {};
  private initialized = false;

  async initialize(config: Record<string, string>): Promise<void> {
    this.config = config;
    this.initialized = true;
  }

  async testConnection(): Promise<boolean> {
    if (!this.initialized) return false;

    // TODO: Implement actual ADO API connectivity test
    // GET {organizationUrl}/{project}/_apis/wit/wiql?api-version=7.0
    // with Basic auth using PAT
    return false;
  }

  async fetchTasks(): Promise<ExternalTask[]> {
    if (!this.initialized) return [];

    // TODO: Implement ADO work item fetch
    // 1. Run WIQL query to find assigned work items:
    //    POST {orgUrl}/{project}/_apis/wit/wiql?api-version=7.0
    //    Body: { "query": "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed'" }
    //
    // 2. Fetch work item details:
    //    GET {orgUrl}/{project}/_apis/wit/workitems?ids={ids}&$expand=all&api-version=7.0
    //
    // 3. Map ADO work items to ExternalTask[]
    return [];
  }

  async pushComment(externalTaskId: string, comment: Comment): Promise<boolean> {
    if (!this.initialized) return false;

    // TODO: Implement pushing comment to ADO
    // POST {orgUrl}/{project}/_apis/wit/workitems/{id}/comments?api-version=7.0-preview.4
    // Body: { "text": comment.body }
    console.log(`ADO: Would push comment to work item ${externalTaskId}:`, comment.body);
    return false;
  }

  async pushStatusUpdate(externalTaskId: string, status: string): Promise<boolean> {
    if (!this.initialized) return false;

    // TODO: Implement status update push to ADO
    // PATCH {orgUrl}/{project}/_apis/wit/workitems/{id}?api-version=7.0
    // Body: [{ "op": "replace", "path": "/fields/System.State", "value": mappedState }]
    console.log(`ADO: Would update work item ${externalTaskId} status to:`, status);
    return false;
  }

  async pushTimeUpdate(externalTaskId: string, totalSeconds: number): Promise<boolean> {
    if (!this.initialized) return false;

    // TODO: Implement time tracking push to ADO
    // PATCH {orgUrl}/{project}/_apis/wit/workitems/{id}?api-version=7.0
    // Body: [{ "op": "replace", "path": "/fields/Microsoft.VSTS.Scheduling.CompletedWork", "value": hours }]
    const hours = totalSeconds / 3600;
    console.log(`ADO: Would update work item ${externalTaskId} completed work to:`, hours, 'hours');
    return false;
  }

  async sync(existingTasks: Task[]): Promise<PluginSyncResult> {
    const result: PluginSyncResult = { created: 0, updated: 0, errors: [] };

    try {
      const externalTasks = await this.fetchTasks();

      // TODO: Implement reconciliation logic:
      // For each external task:
      //   - If no matching local task (by externalId), create one → result.created++
      //   - If matching local task exists, update title/description/status → result.updated++
      // For each local task with this pluginId:
      //   - Push any unsynced comments
      //   - Push time updates
      //   - Push status changes

      if (externalTasks.length === 0 && !this.initialized) {
        result.errors.push('Plugin not configured. Please set Organization URL, Project, and PAT.');
      }
    } catch (err) {
      result.errors.push(`ADO sync error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return result;
  }
}
