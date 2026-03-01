import type {
  CreateTaskInput,
  PluginConfigField,
  PluginSyncResult,
  Task,
  Comment,
} from '../../shared/types';

/**
 * Interface that all source-system plugins must implement.
 *
 * Plugins enable two-way communication with external task/ticket systems:
 * - Pull tasks assigned to the user from the external system
 * - Push comments, time, and status updates back to the external system
 */
export interface SourcePlugin {
  /** Unique identifier for this plugin */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Short description of what this plugin connects to */
  readonly description: string;

  /** Configuration fields the user must provide (PAT tokens, URLs, etc.) */
  readonly configFields: PluginConfigField[];

  /**
   * Initialize the plugin with stored configuration.
   * Called when the plugin is first loaded or when config changes.
   */
  initialize(config: Record<string, string>): Promise<void>;

  /**
   * Test the connection to the external system.
   * Returns true if the connection is valid, false otherwise.
   */
  testConnection(): Promise<boolean>;

  /**
   * Fetch all tasks assigned to the current user from the external system.
   * Returns task creation inputs that the app will use to create/update local tasks.
   */
  fetchTasks(): Promise<ExternalTask[]>;

  /**
   * Push a comment to the external system for a given external task ID.
   */
  pushComment(externalTaskId: string, comment: Comment): Promise<boolean>;

  /**
   * Push a status update to the external system.
   */
  pushStatusUpdate(externalTaskId: string, status: string): Promise<boolean>;

  /**
   * Push time tracking data to the external system.
   */
  pushTimeUpdate(externalTaskId: string, totalSeconds: number): Promise<boolean>;

  /**
   * Perform a full sync: pull tasks from external, reconcile with local.
   */
  sync(existingTasks: Task[]): Promise<PluginSyncResult>;
}

/**
 * Represents a task as fetched from an external system,
 * ready to be created or matched with an existing local task.
 */
export interface ExternalTask extends CreateTaskInput {
  externalId: string;
  /** Optional: external system's status string (will be mapped to local status) */
  externalStatus?: string;
  /** Optional: external system's URL for this task */
  externalUrl?: string;
}
