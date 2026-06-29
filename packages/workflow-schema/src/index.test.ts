import { describe, it, expect } from 'vitest';
import {
  WorkflowTemplateSchema,
  validateWorkflowGraph,
  isTriggerType,
  type WorkflowTemplate,
} from './index.js';

describe('WorkflowTemplateSchema', () => {
  it('accepts a minimal valid template', () => {
    const r = WorkflowTemplateSchema.safeParse({ id: 't1', name: 'Sample' });
    expect(r.success).toBe(true);
  });

  it('rejects a template missing id/name', () => {
    expect(WorkflowTemplateSchema.safeParse({ nodes: [] }).success).toBe(false);
  });

  it('retains optional UI fields (position/label) on parse (no strip)', () => {
    const parsed = WorkflowTemplateSchema.parse({
      id: 't1',
      name: 'Sample',
      nodes: [
        {
          id: 'n1',
          type: 'manual_trigger',
          label: 'Старт',
          position: { x: 120, y: 40 },
        },
      ],
      edges: [{ id: 'e1', from: 'n1', to: 'n1-x', label: 'next' }],
    });
    expect(parsed.nodes[0]?.position).toEqual({ x: 120, y: 40 });
    expect(parsed.nodes[0]?.label).toBe('Старт');
    expect(parsed.edges[0]?.id).toBe('e1');
    expect(parsed.edges[0]?.label).toBe('next');
  });

  it('still accepts old-style nodes/edges without UI fields', () => {
    const r = WorkflowTemplateSchema.safeParse({
      id: 't1',
      name: 'Sample',
      nodes: [{ id: 'n1', type: 'manual_trigger' }],
      edges: [{ from: 'n1', to: 'n2' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('isTriggerType', () => {
  it('matches engine semantics (substring "trigger")', () => {
    expect(isTriggerType('manual_trigger')).toBe(true);
    expect(isTriggerType('schedule_trigger')).toBe(true);
    expect(isTriggerType('TRIGGER')).toBe(true);
    expect(isTriggerType('agent')).toBe(false);
    expect(isTriggerType('tool')).toBe(false);
  });
});

function tpl(partial: Partial<WorkflowTemplate>): WorkflowTemplate {
  return WorkflowTemplateSchema.parse({ id: 't', name: 'n', ...partial });
}

describe('validateWorkflowGraph', () => {
  it('returns no issues for a valid linear graph', () => {
    const issues = validateWorkflowGraph(
      tpl({
        nodes: [
          { id: 'a', type: 'manual_trigger' },
          { id: 'b', type: 'tool', toolRef: 'rag.search' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('flags duplicate node ids', () => {
    const issues = validateWorkflowGraph(
      tpl({
        nodes: [
          { id: 'a', type: 'manual_trigger' },
          { id: 'a', type: 'tool' },
        ],
      }),
    );
    expect(issues.some((i) => i.code === 'DUPLICATE_NODE_ID' && i.nodeId === 'a')).toBe(true);
  });

  it('flags dangling edges', () => {
    const issues = validateWorkflowGraph(
      tpl({
        nodes: [{ id: 'a', type: 'manual_trigger' }],
        edges: [{ from: 'a', to: 'missing' }],
      }),
    );
    expect(issues.some((i) => i.code === 'DANGLING_EDGE')).toBe(true);
  });

  it('flags self-loops', () => {
    const issues = validateWorkflowGraph(
      tpl({
        nodes: [{ id: 'a', type: 'manual_trigger' }],
        edges: [{ from: 'a', to: 'a' }],
      }),
    );
    expect(issues.some((i) => i.code === 'SELF_LOOP')).toBe(true);
  });

  it('flags missing trigger', () => {
    const issues = validateWorkflowGraph(
      tpl({ nodes: [{ id: 'a', type: 'tool', toolRef: 'rag.search' }] }),
    );
    expect(issues.some((i) => i.code === 'NO_TRIGGER')).toBe(true);
  });

  it('flags unreachable non-trigger nodes', () => {
    const issues = validateWorkflowGraph(
      tpl({
        nodes: [
          { id: 'a', type: 'manual_trigger' },
          { id: 'orphan', type: 'tool', toolRef: 'rag.search' },
        ],
      }),
    );
    expect(issues.some((i) => i.code === 'UNREACHABLE_NODE' && i.nodeId === 'orphan')).toBe(true);
  });

  it('warns on cycles without blocking (severity=warning)', () => {
    const issues = validateWorkflowGraph(
      tpl({
        nodes: [
          { id: 'a', type: 'manual_trigger' },
          { id: 'b', type: 'tool' },
          { id: 'c', type: 'tool' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'b' },
        ],
      }),
    );
    const cycle = issues.find((i) => i.code === 'CYCLE');
    expect(cycle?.severity).toBe('warning');
  });

  it('returns no issues for an empty template (nothing to publish yet)', () => {
    expect(validateWorkflowGraph(tpl({}))).toEqual([]);
  });
});
