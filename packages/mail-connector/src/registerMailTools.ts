/**
 * Assembly + registration of mail tools. Handlers are NEVER exported as a public
 * execution surface — they run only via `ToolBroker.invoke`. The full set is wired
 * in `server.ts` next to `registerBaseTools` (gated by `MAIL_CONNECTOR_ENABLED`).
 */
import type { ToolDefinition, ToolRegistry } from '@su10/tools';
import { mailConnectionListTool } from './tools/connectionList.js';
import { mailSearchTool } from './tools/search.js';
import { mailGetMessageTool } from './tools/getMessage.js';
import { mailGetAttachmentsTool } from './tools/getAttachments.js';
import { mailSaveAttachmentsToS3Tool } from './tools/saveAttachmentsToS3.js';
import { mailCreateDraftTool } from './tools/createDraft.js';
import type { MailReadToolDeps, MailToolDeps } from './tools/deps.js';

/** The four read-only mail tools. */
export function createMailReadTools(deps: MailReadToolDeps): ToolDefinition[] {
  return [
    mailConnectionListTool(deps),
    mailSearchTool(deps),
    mailGetMessageTool(deps),
    mailGetAttachmentsTool(deps),
  ];
}

export function registerMailReadTools(registry: ToolRegistry, deps: MailReadToolDeps): void {
  for (const tool of createMailReadTools(deps)) registry.register(tool);
}

/** All six mail tools: read tools + side-effecting save/draft. */
export function createMailTools(deps: MailToolDeps): ToolDefinition[] {
  return [
    ...createMailReadTools(deps),
    mailSaveAttachmentsToS3Tool(deps),
    mailCreateDraftTool(deps),
  ];
}

export function registerMailTools(registry: ToolRegistry, deps: MailToolDeps): void {
  for (const tool of createMailTools(deps)) registry.register(tool);
}
