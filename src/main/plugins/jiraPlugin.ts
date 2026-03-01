import type { PluginConfigField, PluginSyncResult, Task, Comment } from '../../shared/types';
import type { ExternalTask, SourcePlugin } from './pluginInterface';

/**
 * Jira plugin scaffold.
 *
 * Connects to Jira (Cloud or Server) via REST API to pull issues
 * assigned to the user and push comments/time/status updates back.
 *
 * Configuration required:
 * - baseUrl: e.g. https://mycompany.atlassian.net
 * - email: User's email for Jira Cloud
 * - apiToken: API token (Cloud) or password (Server)
 * - jql: Optional JQL query override
 */
export class JiraPlugin implements SourcePlugin {
  readonly id = 'jira';
  readonly name = 'Jira';
  readonly description = 'Sync issues from Jira (Cloud or Server)';

  readonly configFields: PluginConfigField[] = [
    { key: 'baseUrl', label: 'Jira Base URL', type: 'url', required: true },
    { key: 'email', label: 'Email', type: 'string', required: true },
    { key: 'apiToken', label: 'API Token', type: 'password', required: true },
    { key: 'jql', label: 'JQL Query (optional)', type: 'string', required: false },
  ];

  private config: Record<string, string> = {};
  private initialized = false;

  async initialize(config: Record<string, string>): Promise<void> {
    this.config = config;
    this.initialized = true;
  }

  async testConnection(): Promise<boolean> {
    if (!this.initialized) return false;

    // TODO: Implement actual Jira API connectivity test
    // GET {baseUrl}/rest/api/3/myself
    // with Basic auth (email:apiToken)
    return false;
  }

  async fetchTasks(): Promise<ExternalTask[]> {
    if (!this.initialized) return [];

    // TODO: Implement Jira issue fetch
    // 1. Search for assigned issues:
    //    GET {baseUrl}/rest/api/3/search?jql=assignee=currentUser()+AND+status!=Done&fields=summary,description,status
    //
    // 2. Map Jira issues to ExternalTask[]:
    //    - issue.key → externalId
    //    - issue.fields.summary → title
    //    - issue.fields.description → description (convert ADF to plain text)
    //    - issue.fields.status.name → externalStatus
    return [];
  }

  async pushComment(externalTaskId: string, comment: Comment): Promise<boolean> {
    if (!this.initialized) return false;

    // TODO: Implement pushing comment to Jira
    // POST {baseUrl}/rest/api/3/issue/{issueKey}/comment
    // Body: { "body": { "type": "doc", "version": 1, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": comment.body }]}] } }
    console.log(`Jira: Would push comment to issue ${externalTaskId}:`, comment.body);
    return false;
  }

  async pushStatusUpdate(externalTaskId: string, status: string): Promise<boolean> {
    if (!this.initialized) return false;

    // TODO: Implement status transition in Jira
    // 1. GET {baseUrl}/rest/api/3/issue/{issueKey}/transitions
    // 2. Find transition matching desired status
    // 3. POST {baseUrl}/rest/api/3/issue/{issueKey}/transitions
    //    Body: { "transition": { "id": transitionId } }
    console.log(`Jira: Would transition issue ${externalTaskId} to:`, status);
    return false;
  }

  async pushTimeUpdate(externalTaskId: string, totalSeconds: number): Promise<boolean> {
    if (!this.initialized) return false;

    // TODO: Implement worklog push to Jira
    // POST {baseUrl}/rest/api/3/issue/{issueKey}/worklog
    // Body: { "timeSpentSeconds": totalSeconds }
    console.log(`Jira: Would log ${totalSeconds}s to issue ${externalTaskId}`);
    return false;
  }

  async sync(existingTasks: Task[]): Promise<PluginSyncResult> {
    const result: PluginSyncResult = { created: 0, updated: 0, errors: [] };

    try {
      const externalTasks = await this.fetchTasks();

      // TODO: Implement reconciliation logic (same pattern as ADO):
      // For each external task:
      //   - If no matching local task (by externalId), create one → result.created++
      //   - If matching local task exists, update title/description/status → result.updated++
      // For each local task with this pluginId:
      //   - Push any unsynced comments
      //   - Push time updates

      if (externalTasks.length === 0 && !this.initialized) {
        result.errors.push('Plugin not configured. Please set Base URL, Email, and API Token.');
      }
    } catch (err) {
      result.errors.push(`Jira sync error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return result;
  }
}
