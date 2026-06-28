/**
 * Tool Broker — ЕДИНСТВЕННЫЙ путь исполнения инструмента.
 *
 * Pipeline: resolve → validate input → permission (can + allowedRoles) →
 * risk policy → approval → timeout+exec → validate output → audit+recorder.
 * На КАЖДОМ выходе пишется ровно одна запись в `tool_call_logs` (recorder) и одно
 * бизнес-событие в `audit_events` (audit). Хранятся только хэши/коды, не сырьё.
 */
import type { ZodError } from 'zod';
import {
  AppError,
  AuthzError,
  NotFoundError,
  ToolApprovalRequiredError,
  UpstreamError,
  ValidationError,
} from '@su10/errors';
import {
  can,
  defaultApprovalPolicy,
  type ApprovalPolicy,
} from '@su10/permissions';
import { audit } from '@su10/audit';
import { hashJson } from './hash.js';
import { ToolRegistry } from './registry.js';
import {
  noopToolCallRecorder,
  type ResolvedPolicy,
  type ToolCallRecord,
  type ToolCallRecorder,
  type ToolCallStatus,
  type ToolPolicyResolver,
} from './recorder.js';
import type { ToolContext, ToolDefinition } from './types.js';

export interface ToolBrokerOptions {
  approvalPolicy?: ApprovalPolicy;
  policyResolver?: ToolPolicyResolver;
  recorder?: ToolCallRecorder;
}

const AUDIT_OUTCOME: Record<ToolCallStatus, 'success' | 'denied' | 'failure'> = {
  success: 'success',
  denied: 'denied',
  approval_required: 'denied',
  failure: 'failure',
};

/** Issues без значений (path+message) — безопасно для клиента. */
function zodIssues(err: ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

export class ToolBroker {
  private readonly recorder: ToolCallRecorder;
  private readonly policyResolver: ToolPolicyResolver;

  constructor(
    private readonly registry: ToolRegistry,
    opts: ToolBrokerOptions = {},
  ) {
    const approvalPolicy: ApprovalPolicy = opts.approvalPolicy ?? defaultApprovalPolicy;
    this.recorder = opts.recorder ?? noopToolCallRecorder;
    this.policyResolver =
      opts.policyResolver ??
      ({
        resolve: (tool: ToolDefinition): ResolvedPolicy => ({
          requiresApproval: tool.requiresApproval === true || approvalPolicy.requiresApproval(tool.riskLevel),
        }),
      } satisfies ToolPolicyResolver);
  }

  async invoke(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
    const startMs = Date.now();
    const tool = this.registry.get(name);

    const finish = async (p: {
      status: ToolCallStatus;
      redactedErrorCode?: string;
      inputHash?: string;
      outputHash?: string;
    }): Promise<void> => {
      const rec: ToolCallRecord = {
        toolName: name,
        toolVersion: tool?.version ?? 0,
        subjectId: ctx.subject.id,
        status: p.status,
        riskLevel: tool?.riskLevel ?? 'low',
        approved: ctx.approved === true,
        durationMs: Date.now() - startMs,
        at: ctx.at,
        ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
        ...(ctx.agentRunId ? { agentRunId: ctx.agentRunId } : {}),
        ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
        ...(p.inputHash ? { inputHash: p.inputHash } : {}),
        ...(p.outputHash ? { outputHash: p.outputHash } : {}),
        ...(p.redactedErrorCode ? { redactedErrorCode: p.redactedErrorCode } : {}),
      };
      await this.recorder.record(rec);
      await audit(ctx.auditSink, {
        actor: ctx.subject.id,
        action: name,
        outcome: AUDIT_OUTCOME[p.status],
        at: ctx.at,
        ...(tool ? { resource: `tool:${name}` } : {}),
        meta: {
          status: p.status,
          ...(p.redactedErrorCode ? { errorCode: p.redactedErrorCode } : {}),
        },
      });
    };

    // 1) resolve
    if (!tool) {
      await finish({ status: 'failure', redactedErrorCode: 'NOT_FOUND' });
      throw new NotFoundError(`Unknown tool: ${name}`);
    }

    // 2) validate input
    const parsedInput = tool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      await finish({ status: 'failure', redactedErrorCode: 'VALIDATION_FAILED' });
      throw new ValidationError('Invalid tool input', { tool: name }, zodIssues(parsedInput.error));
    }
    const inputHash = hashJson(parsedInput.data);

    // 3) permission (can + allowedRoles)
    const decision = can(ctx.subject, name);
    const rolesOk =
      !tool.allowedRoles?.length ||
      ctx.subject.roles.includes('admin') ||
      tool.allowedRoles.some((r) => ctx.subject.roles.includes(r));
    if (!decision.allowed || !rolesOk) {
      await finish({ status: 'denied', redactedErrorCode: 'AUTHZ_DENIED', inputHash });
      throw new AuthzError(`Permission denied for tool "${name}"`);
    }

    // 4) risk policy
    const policy = await this.policyResolver.resolve(tool);

    // 5) approval
    const autoApproved = policy.autoApproveRoles?.some((r) => ctx.subject.roles.includes(r)) ?? false;
    if (policy.requiresApproval && ctx.approved !== true && !autoApproved) {
      await finish({ status: 'approval_required', redactedErrorCode: 'TOOL_APPROVAL_REQUIRED', inputHash });
      throw new ToolApprovalRequiredError(`Tool "${name}" requires approval`, {
        riskLevel: tool.riskLevel,
      });
    }

    // 6) timeout + execution
    let output: unknown;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      output = await Promise.race([
        tool.handler(parsedInput.data, { ...ctx, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new UpstreamError('Tool execution timed out', { tool: name, timeoutMs: tool.timeoutMs }));
          }, tool.timeoutMs);
        }),
      ]);
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UPSTREAM_ERROR';
      await finish({ status: 'failure', redactedErrorCode: code, inputHash });
      if (err instanceof AppError) throw err;
      throw new UpstreamError(`Tool "${name}" failed`, { tool: name });
    } finally {
      if (timer) clearTimeout(timer);
    }

    // 7) validate output
    const parsedOutput = tool.outputSchema.safeParse(output);
    if (!parsedOutput.success) {
      await finish({ status: 'failure', redactedErrorCode: 'VALIDATION_FAILED', inputHash });
      throw new ValidationError('Invalid tool output', { tool: name });
    }
    const outputHash = hashJson(parsedOutput.data);

    // 8) success
    await finish({ status: 'success', inputHash, outputHash });
    return parsedOutput.data;
  }
}
