/**
 * Re-export shim. The CtClient implementation lives in
 * `@central-tracking/plugin-client` so it can be shared across plugins.
 * Keeping this file lets ADO-internal callers (and tests) continue to
 * `import { CtClient } from './ct-client'` without churn.
 */
export { CtClient, envVarNameFor } from '@central-tracking/plugin-client';
export type { GetTasksFilter, UpdateCommentPatch, CtClientOptions } from '@central-tracking/plugin-client';
