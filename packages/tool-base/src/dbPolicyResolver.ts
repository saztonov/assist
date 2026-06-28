/**
 * DB-backed `ToolPolicyResolver` (через `@su10/db` toolRepo): читает
 * `tool_approval_policies` по name+riskLevel. Если запись отсутствует — fallback
 * на статическую политику (tool.requiresApproval || default: high → approval).
 */
import { createToolRepo, type Database } from '@su10/db';
import { defaultApprovalPolicy, type ApprovalPolicy } from '@su10/permissions';
import type { ResolvedPolicy, ToolDefinition, ToolPolicyResolver } from '@su10/tools';

export function createDbPolicyResolver(
  db: Database,
  approvalPolicy: ApprovalPolicy = defaultApprovalPolicy,
): ToolPolicyResolver {
  const repo = createToolRepo(db);
  return {
    async resolve(tool: ToolDefinition): Promise<ResolvedPolicy> {
      const fallback: ResolvedPolicy = {
        requiresApproval:
          tool.requiresApproval === true || approvalPolicy.requiresApproval(tool.riskLevel),
      };
      const pol = await repo.getApprovalPolicy(tool.name, tool.riskLevel);
      if (!pol) return fallback;
      return {
        requiresApproval: pol.requiresApproval,
        ...(pol.autoApproveRoles ? { autoApproveRoles: pol.autoApproveRoles } : {}),
      };
    },
  };
}
