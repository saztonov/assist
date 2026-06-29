/**
 * Tool Registry: реестр инструментов (code-first) + публичная проекция метаданных
 * БЕЗ `handler`. Зод-схемы конвертируются в JSON Schema для API; `checksum`
 * привязан к name/version/схемам и зеркалируется в `tool_versions.checksum`.
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { RiskLevel } from '@su10/permissions';
import { hashJson } from './hash.js';
import type { ToolCategory, ToolDefinition } from './types.js';

export interface ToolMetadata {
  name: string;
  version: number;
  description: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  allowedRoles?: string[];
  requiresApproval: boolean;
  timeoutMs: number;
  inputSchema: unknown;
  outputSchema: unknown;
  checksum: string;
}

const REQUIRED_FIELDS = [
  'name',
  'version',
  'description',
  'category',
  'riskLevel',
  'inputSchema',
  'outputSchema',
  'timeoutMs',
  'handler',
] as const;

/** Публичная проекция: НИКОГДА не содержит `handler`. */
export function toToolMetadata(tool: ToolDefinition): ToolMetadata {
  const inputSchema = zodToJsonSchema(tool.inputSchema, { target: 'jsonSchema7' });
  const outputSchema = zodToJsonSchema(tool.outputSchema, { target: 'jsonSchema7' });
  return {
    name: tool.name,
    version: tool.version,
    description: tool.description,
    category: tool.category,
    riskLevel: tool.riskLevel,
    ...(tool.allowedRoles ? { allowedRoles: tool.allowedRoles } : {}),
    requiresApproval: tool.requiresApproval ?? false,
    timeoutMs: tool.timeoutMs,
    inputSchema,
    outputSchema,
    checksum: hashJson({ name: tool.name, version: tool.version, inputSchema, outputSchema }),
  };
}

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

  /** Удаляет инструмент из реестра (для runtime enable/disable динамических tools). */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Зарегистрирован ли инструмент с таким именем. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Метаданные одного инструмента (без handler). */
  describe(name: string): ToolMetadata | undefined {
    const tool = this.tools.get(name);
    return tool ? toToolMetadata(tool) : undefined;
  }

  /** Метаданные всех инструментов (без handler). */
  listMetadata(): ToolMetadata[] {
    return this.list().map(toToolMetadata);
  }
}
