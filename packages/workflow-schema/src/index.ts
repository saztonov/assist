/**
 * Shared contract for WorkflowTemplate JSON. BROWSER-SAFE (zod only, no IO,
 * no Temporal). Imported by both the web Visual Builder and the workflow engine.
 *
 * UI-поля (`position`, `label`, edge `id`/`label`) ОПЦИОНАЛЬНЫ и игнорируются
 * движком оркестрации — они нужны лишь визуальному конструктору, чтобы раскладка
 * React Flow переживала round-trip через backend-валидацию (jsonb, без миграции).
 */
import { z } from 'zod';

/** Координаты узла на канвасе React Flow (engine-ignored). */
export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  toolRef: z.string().optional(),
  params: z.record(z.unknown()).default({}),
  // UI-поля (engine-ignored, для конструктора):
  position: NodePositionSchema.optional(),
  label: z.string().optional(),
});

export const WorkflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  // UI-поля (engine-ignored): стабильный id ребра для React Flow и подпись.
  id: z.string().optional(),
  label: z.string().optional(),
});

export const WorkflowTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().nonnegative().default(1),
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
});

export type NodePosition = z.infer<typeof NodePositionSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;

/**
 * Триггерный ли узел. Совпадает с трактовкой движка
 * (`runVisualTemplate`: `node.type.toLowerCase().includes('trigger')` → no-op).
 */
export function isTriggerType(type: string): boolean {
  return type.toLowerCase().includes('trigger');
}

/** Коды проблем графа. */
export type GraphIssueCode =
  | 'DUPLICATE_NODE_ID'
  | 'DANGLING_EDGE'
  | 'SELF_LOOP'
  | 'NO_TRIGGER'
  | 'UNREACHABLE_NODE'
  | 'CYCLE';

export interface GraphIssue {
  code: GraphIssueCode;
  message: string;
  severity: 'error' | 'warning';
  /** Узел, к которому относится проблема (если применимо). */
  nodeId?: string;
  /** Ребро, к которому относится проблема (если применимо). */
  edge?: { from: string; to: string };
}

/**
 * Чистая структурная валидация графа WorkflowTemplate (НЕ исполняет, НЕ ходит в
 * Tool Registry — доступность `toolRef` проверяет backend). Детерминированный
 * список проблем; пустой массив = граф структурно корректен.
 *
 * Правила (errors): дубли node id; висящие рёбра (from/to → несуществующий узел);
 * self-loop; нет ни одного trigger-узла; не-trigger узел недостижим от триггеров.
 * Предупреждения (warnings): цикл в графе.
 */
export function validateWorkflowGraph(template: WorkflowTemplate): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const { nodes, edges } = template;

  // 1. Дубликаты id.
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) duplicates.add(node.id);
    seen.add(node.id);
  }
  for (const id of duplicates) {
    issues.push({
      code: 'DUPLICATE_NODE_ID',
      message: `Дублирующийся id узла: ${id}`,
      severity: 'error',
      nodeId: id,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));

  // 2 + 3. Висящие рёбра и self-loop. Валидные рёбра идут в граф достижимости.
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.from === edge.to) {
      issues.push({
        code: 'SELF_LOOP',
        message: `Петля на узле: ${edge.from}`,
        severity: 'error',
        edge: { from: edge.from, to: edge.to },
      });
      continue;
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push({
        code: 'DANGLING_EDGE',
        message: `Ребро ссылается на несуществующий узел: ${edge.from} → ${edge.to}`,
        severity: 'error',
        edge: { from: edge.from, to: edge.to },
      });
      continue;
    }
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    else adjacency.set(edge.from, [edge.to]);
  }

  // 4. Наличие триггера.
  const triggerNodes = nodes.filter((n) => isTriggerType(n.type));
  if (nodes.length > 0 && triggerNodes.length === 0) {
    issues.push({
      code: 'NO_TRIGGER',
      message: 'В шаблоне нет ни одного триггера (Manual/Schedule Trigger)',
      severity: 'error',
    });
  }

  // 5. Достижимость не-trigger узлов от триггеров (BFS по валидным рёбрам).
  if (triggerNodes.length > 0) {
    const reachable = new Set<string>();
    const queue: string[] = triggerNodes.map((n) => n.id);
    for (const id of queue) reachable.add(id);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const next of adjacency.get(current) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    for (const node of nodes) {
      if (!isTriggerType(node.type) && !reachable.has(node.id)) {
        issues.push({
          code: 'UNREACHABLE_NODE',
          message: `Узел недостижим от триггера: ${node.id}`,
          severity: 'error',
          nodeId: node.id,
        });
      }
    }
  }

  // 6. Цикл (warning, не блокирует): DFS по валидным рёбрам.
  if (hasCycle(nodeIds, adjacency)) {
    issues.push({
      code: 'CYCLE',
      message: 'В графе обнаружен цикл',
      severity: 'warning',
    });
  }

  return issues;
}

/** Обнаружение цикла в ориентированном графе (DFS с тремя цветами). */
function hasCycle(nodeIds: Set<string>, adjacency: Map<string, string[]>): boolean {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);

  const visit = (id: string): boolean => {
    color.set(id, GREY);
    for (const next of adjacency.get(id) ?? []) {
      const c = color.get(next);
      if (c === GREY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };

  for (const id of nodeIds) {
    if (color.get(id) === WHITE && visit(id)) return true;
  }
  return false;
}
