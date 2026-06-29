/**
 * Преобразование React Flow ↔ WorkflowTemplate JSON. Чистый модуль (без
 * @xyflow/react) — типы канваса заданы локально (структурно совместимы с RF Node/Edge),
 * чтобы round-trip тестировался без браузера. Координаты ↔ node.position,
 * source/target ↔ from/to. Для agent-блоков agentName кладётся в params.agentName.
 */
import {
  WorkflowTemplateSchema,
  type WorkflowTemplate,
  type WorkflowNode,
} from '@su10/workflow-schema';
import { BASE_BLOCKS, matchBlockKey } from './catalog.js';

export interface RfNodeData {
  catalogKey?: string;
  nodeType: string;
  toolRef?: string;
  agentName?: string;
  label?: string;
  params: Record<string, unknown>;
  // @xyflow/react требует, чтобы data расширяла Record<string, unknown>.
  [key: string]: unknown;
}

export interface RfNodeLike {
  id: string;
  position: { x: number; y: number };
  data: RfNodeData;
}

export interface RfEdgeLike {
  id: string;
  source: string;
  target: string;
}

export interface TemplateMeta {
  id: string;
  name: string;
  version: number;
}

function gridPosition(index: number): { x: number; y: number } {
  return { x: 80 + (index % 4) * 240, y: 80 + Math.floor(index / 4) * 140 };
}

function defaultLabel(node: WorkflowNode): string {
  const key = matchBlockKey({
    type: node.type,
    ...(node.toolRef ? { toolRef: node.toolRef } : {}),
    ...(typeof node.params.agentName === 'string' ? { agentName: node.params.agentName } : {}),
  });
  return BASE_BLOCKS.find((b) => b.key === key)?.label ?? node.toolRef ?? node.type;
}

/** React Flow → WorkflowTemplate JSON (для сохранения). */
export function rfToTemplate(
  meta: TemplateMeta,
  nodes: RfNodeLike[],
  edges: RfEdgeLike[],
): WorkflowTemplate {
  return {
    id: meta.id,
    name: meta.name,
    version: meta.version,
    nodes: nodes.map((n) => {
      const params: Record<string, unknown> = {
        ...n.data.params,
        ...(n.data.agentName ? { agentName: n.data.agentName } : {}),
      };
      return {
        id: n.id,
        type: n.data.nodeType,
        ...(n.data.toolRef ? { toolRef: n.data.toolRef } : {}),
        ...(n.data.label ? { label: n.data.label } : {}),
        position: { x: n.position.x, y: n.position.y },
        params,
      };
    }),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target })),
  };
}

/** WorkflowTemplate JSON → React Flow (для открытия). */
export function templateToRf(template: WorkflowTemplate): {
  nodes: RfNodeLike[];
  edges: RfEdgeLike[];
} {
  return {
    nodes: template.nodes.map((n, i) => {
      const agentName = typeof n.params.agentName === 'string' ? n.params.agentName : undefined;
      const params = { ...n.params };
      delete params.agentName;
      return {
        id: n.id,
        position: n.position ?? gridPosition(i),
        data: {
          catalogKey: matchBlockKey({
            type: n.type,
            ...(n.toolRef ? { toolRef: n.toolRef } : {}),
            ...(agentName ? { agentName } : {}),
          }),
          nodeType: n.type,
          ...(n.toolRef ? { toolRef: n.toolRef } : {}),
          ...(agentName ? { agentName } : {}),
          label: n.label ?? defaultLabel(n),
          params,
        },
      };
    }),
    edges: template.edges.map((e, i) => ({
      id: e.id ?? `${e.from}->${e.to}-${i}`,
      source: e.from,
      target: e.to,
    })),
  };
}

export interface TemplateValidation {
  ok: boolean;
  issues: string[];
}

/** Структурная валидация (zod). Граф-правила — отдельно через validateWorkflowGraph. */
export function validateTemplate(template: unknown): TemplateValidation {
  const parsed = WorkflowTemplateSchema.safeParse(template);
  if (parsed.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
