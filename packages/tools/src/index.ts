/**
 * Tool Registry + Tool Broker. NODE-ONLY.
 * Every tool declares input_schema, output_schema, risk_level, permission check,
 * audit and approval policy. The Broker is the ONLY way to execute a tool.
 */
import type { ZodTypeAny } from 'zod';
import { ToolApprovalRequiredError } from '@su10/errors';
import {
  can,
  defaultApprovalPolicy,
  type ApprovalPolicy,
  type RiskLevel,
  type Subject,
} from '@su10/permissions';
import { audit, type AuditSink } from '@su10/audit';

export interface ToolContext {
  subject: Subject;
  approved?: boolean;
  auditSink: AuditSink;
  /** ISO timestamp for audit events (deterministic, testable). */
  at: string;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  riskLevel: RiskLevel;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

const REQUIRED_FIELDS = [
  'name',
  'description',
  'inputSchema',
  'outputSchema',
  'riskLevel',
  'execute',
] as const;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    for (const field of REQUIRED_FIELDS) {
      if (tool[field] === undefined || tool[field] === null) {
        throw new Error(`Tool "${tool.name ?? '?'}" is missing required field "${field}"`);
      }
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}

export class ToolBroker {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly approvalPolicy: ApprovalPolicy = defaultApprovalPolicy,
  ) {}

  async invoke(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
    const tool = this.registry.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    const decision = can(ctx.subject, name);
    if (!decision.allowed) {
      await audit(ctx.auditSink, { actor: ctx.subject.id, action: name, outcome: 'denied', at: ctx.at });
      throw new ToolApprovalRequiredError(`Permission denied for tool "${name}"`);
    }

    if (this.approvalPolicy.requiresApproval(tool.riskLevel) && !ctx.approved) {
      await audit(ctx.auditSink, { actor: ctx.subject.id, action: name, outcome: 'denied', at: ctx.at });
      throw new ToolApprovalRequiredError(`Tool "${name}" is high-risk and requires approval`);
    }

    const parsedInput = tool.inputSchema.parse(input);
    const output = await tool.execute(parsedInput, ctx);
    const parsedOutput = tool.outputSchema.parse(output);
    await audit(ctx.auditSink, { actor: ctx.subject.id, action: name, outcome: 'success', at: ctx.at });
    return parsedOutput;
  }
}
