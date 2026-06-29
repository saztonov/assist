/**
 * Валидация WorkflowTemplate перед publish/test-run: zod-форма + структура графа
 * (`validateWorkflowGraph` из browser-safe контракта) + доступность инструментов
 * по Tool Registry. Гарантирует «no unknown toolRef reaches runtime».
 *
 * draft-сохранение НЕ использует эту проверку (черновик пермиссивен — только zod
 * на границе DTO). publish и test-run — используют (ошибки уровня error блокируют).
 */
import {
  WorkflowTemplateSchema,
  validateWorkflowGraph,
  isTriggerType,
  type WorkflowTemplate,
} from '@su10/workflow-schema';
import type { ToolRegistry } from '@su10/tools';

/** Известные LangGraph-агенты (этап 7). agent-узлы должны ссылаться на один из них. */
const KNOWN_AGENTS = new Set(['chat_agent', 'rag_agent', 'document_extraction_agent']);

export interface TemplateIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  nodeId?: string;
}

export interface TemplateValidationResult {
  ok: boolean;
  issues: TemplateIssue[];
  /** Распарсенный шаблон (если zod-форма валидна) — для test-run. */
  template?: WorkflowTemplate;
}

/** Имя агента для agent-узла (toolRef → params.agentName → дефолт). */
function agentNameOf(node: WorkflowTemplate['nodes'][number]): string {
  return node.toolRef ?? String(node.params.agentName ?? 'chat_agent');
}

/**
 * Полная валидация для publish/test-run. `ok=false`, если есть хоть одна проблема
 * уровня `error` (warnings, напр. цикл, не блокируют).
 */
export function validateTemplateForRun(
  definition: unknown,
  toolRegistry: ToolRegistry,
): TemplateValidationResult {
  const parsed = WorkflowTemplateSchema.safeParse(definition);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [
        {
          code: 'SCHEMA_INVALID',
          message: 'Определение шаблона не проходит схему WorkflowTemplate',
          severity: 'error',
        },
      ],
    };
  }
  const template = parsed.data;
  const issues: TemplateIssue[] = validateWorkflowGraph(template).map((i) => ({
    code: i.code,
    message: i.message,
    severity: i.severity,
    ...(i.nodeId ? { nodeId: i.nodeId } : {}),
  }));

  // Пустой шаблон структурно валиден (чистый граф-валидатор лоялен к пустому
  // канвасу), но публиковать/прогонять «нечего» — гейт publish/test-run его отклоняет.
  if (template.nodes.length === 0) {
    issues.push({
      code: 'EMPTY_TEMPLATE',
      message: 'Шаблон пуст: добавьте хотя бы триггер и один шаг',
      severity: 'error',
    });
  }

  for (const node of template.nodes) {
    const type = node.type.toLowerCase();
    if (isTriggerType(type) || type === 'approval') continue;
    if (type === 'agent') {
      const agent = agentNameOf(node);
      if (!KNOWN_AGENTS.has(agent)) {
        issues.push({
          code: 'AGENT_UNAVAILABLE',
          message: `Неизвестный агент: ${agent}`,
          severity: 'error',
          nodeId: node.id,
        });
      }
      continue;
    }
    // tool-узел: имя инструмента = toolRef ?? type.
    const toolName = node.toolRef ?? node.type;
    if (!toolRegistry.get(toolName)) {
      issues.push({
        code: 'TOOL_UNAVAILABLE',
        message: `Инструмент не зарегистрирован: ${toolName}`,
        severity: 'error',
        nodeId: node.id,
      });
    }
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues, template };
}
