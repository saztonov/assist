import { describe, it, expect } from 'vitest';
import { WorkflowTemplateSchema } from '@su10/workflow-schema';
import { rfToTemplate, templateToRf, validateTemplate, type RfNodeLike } from './mapping.js';

const META = { id: 't1', name: 'Demo', version: 1 };

describe('mapping round-trip', () => {
  it('preserves nodes/edges/positions/params/labels (template → rf → template)', () => {
    const original = WorkflowTemplateSchema.parse({
      id: 't1',
      name: 'Demo',
      version: 1,
      nodes: [
        { id: 'a', type: 'manual_trigger', label: 'Старт', position: { x: 10, y: 20 } },
        {
          id: 'b',
          type: 'tool',
          toolRef: 'rag.search',
          label: 'Поиск',
          position: { x: 250, y: 20 },
          params: { query: 'q', k: 5 },
        },
        {
          id: 'c',
          type: 'agent',
          label: 'Сводка',
          position: { x: 500, y: 20 },
          params: { agentName: 'chat_agent', prompt: 'summarize' },
        },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'c' },
      ],
    });

    const rf = templateToRf(original);
    const back = rfToTemplate(META, rf.nodes, rf.edges);

    expect(back.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(back.nodes[0]?.position).toEqual({ x: 10, y: 20 });
    expect(back.nodes[1]?.toolRef).toBe('rag.search');
    expect(back.nodes[1]?.params).toEqual({ query: 'q', k: 5 });
    // agentName round-trips through params.
    expect(back.nodes[2]?.params.agentName).toBe('chat_agent');
    expect(back.nodes[2]?.params.prompt).toBe('summarize');
    expect(back.edges).toEqual([
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'c' },
    ]);
  });

  it('agent block: data.agentName is extracted from params and put back', () => {
    const rf = templateToRf(
      WorkflowTemplateSchema.parse({
        id: 't',
        name: 'n',
        nodes: [{ id: 'x', type: 'agent', params: { agentName: 'document_extraction_agent', prompt: 'p' } }],
        edges: [],
      }),
    );
    const node = rf.nodes[0];
    expect(node?.data.agentName).toBe('document_extraction_agent');
    // params no longer carry agentName on the RF side.
    expect(node?.data.params.agentName).toBeUndefined();
    expect(node?.data.params.prompt).toBe('p');

    const back = rfToTemplate(META, rf.nodes, []);
    expect(back.nodes[0]?.params.agentName).toBe('document_extraction_agent');
  });

  it('generates edge ids and grid positions for legacy templates', () => {
    const rf = templateToRf(
      WorkflowTemplateSchema.parse({
        id: 't',
        name: 'n',
        nodes: [{ id: 'a', type: 'manual_trigger' }],
        edges: [{ from: 'a', to: 'b' }],
      }),
    );
    expect(rf.nodes[0]?.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(rf.edges[0]?.id).toBeTruthy();
  });
});

describe('validateTemplate', () => {
  it('ok for a valid template', () => {
    const r = validateTemplate({ id: 't', name: 'n', nodes: [], edges: [] });
    expect(r.ok).toBe(true);
  });

  it('flattens issues for an invalid template (missing name)', () => {
    const r = validateTemplate({ id: 't', nodes: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

// RfNodeLike used implicitly above; keep the import meaningful for type-checkers.
const _typecheck: RfNodeLike | undefined = undefined;
void _typecheck;
