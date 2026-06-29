/**
 * Состояние редактора конструктора + действия к backend (load/saveDraft/publish/
 * testRun) и операции графа. Сеть — только через `api`-клиент (/api/v1). Сам workflow
 * НЕ исполняется во фронтенде. Граф-валидация — общий `validateWorkflowGraph`.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Edge,
  type Connection,
} from '@xyflow/react';
import { message } from 'antd';
import { validateWorkflowGraph, type GraphIssue } from '@su10/workflow-schema';
import { api } from '../../api/client';
import type { BlockDef } from './catalog';
import { rfToTemplate, templateToRf, validateTemplate } from './mapping';
import type { BlockNodeType } from './canvas/nodeType';
import type { WorkflowTemplateDetail } from './types';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function newNodeId(): string {
  return `n-${crypto.randomUUID()}`;
}

export interface WorkflowEditorApi {
  nodes: BlockNodeType[];
  edges: Edge[];
  onNodesChange: ReturnType<typeof useNodesState<BlockNodeType>>[2];
  onEdgesChange: ReturnType<typeof useEdgesState<Edge>>[2];
  onConnect: (c: Connection) => void;
  addNode: (block: BlockDef, position?: { x: number; y: number }) => void;
  updateNode: (id: string, patch: Partial<BlockNodeType['data']>) => void;
  removeNode: (id: string) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedNode: BlockNodeType | undefined;
  name: string;
  setName: (n: string) => void;
  status: 'draft' | 'published';
  version: number;
  templateId: string | null;
  busy: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  graphIssues: GraphIssue[];
  saveDraft: () => Promise<string | null>;
  publish: () => Promise<void>;
  testRun: () => Promise<string | null>;
}

export function useWorkflowEditor(
  initialTemplateId: string | null,
  onSavedId?: (id: string) => void,
): WorkflowEditorApi {
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId);
  const [name, setName] = useState('Новый шаблон');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [version, setVersion] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!templateId) {
      setNodes([]);
      setEdges([]);
      return;
    }
    try {
      const detail = await api.get<WorkflowTemplateDetail>(`/workflow-templates/${templateId}`);
      setName(detail.name);
      setStatus(detail.status);
      setVersion(detail.latestVersion);
      const rf = templateToRf(detail.definition);
      setNodes(rf.nodes.map((n) => ({ ...n, type: 'block' as const })));
      setEdges(rf.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (block: BlockDef, position?: { x: number; y: number }) => {
      const id = newNodeId();
      setNodes((ns) =>
        ns.concat({
          id,
          type: 'block' as const,
          position: position ?? { x: 140 + ns.length * 36, y: 120 + ns.length * 24 },
          data: {
            catalogKey: block.key,
            nodeType: block.nodeType,
            ...(block.toolRef ? { toolRef: block.toolRef } : {}),
            ...(block.agentName ? { agentName: block.agentName } : {}),
            label: block.label,
            params: {},
          },
        }),
      );
      setSelectedId(id);
    },
    [setNodes],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<BlockNodeType['data']>) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
    },
    [setNodes],
  );

  const removeNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((s) => (s === id ? null : s));
    },
    [setNodes, setEdges],
  );

  const buildTemplate = useCallback(
    () =>
      rfToTemplate(
        { id: templateId ?? 'draft', name, version },
        nodes.map((n) => ({ id: n.id, position: n.position, data: n.data })),
        edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      ),
    [templateId, name, version, nodes, edges],
  );

  const graphIssues = validateWorkflowGraph(buildTemplate());

  const saveDraft = useCallback(async (): Promise<string | null> => {
    setError(null);
    const tpl = buildTemplate();
    const structural = validateTemplate(tpl);
    if (!structural.ok) {
      setError(structural.issues.join('; '));
      return null;
    }
    setBusy(true);
    try {
      if (!templateId) {
        const created = await api.post<WorkflowTemplateDetail>('/workflow-templates', {
          name,
          definition: tpl,
        });
        setTemplateId(created.id);
        setStatus(created.status);
        setVersion(created.latestVersion);
        onSavedId?.(created.id);
        message.success('Черновик создан');
        return created.id;
      }
      const saved = await api.put<WorkflowTemplateDetail>(
        `/workflow-templates/${templateId}/draft`,
        { definition: tpl },
      );
      setStatus(saved.status);
      setVersion(saved.latestVersion);
      message.success('Черновик сохранён');
      return templateId;
    } catch (e) {
      setError(errMsg(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [buildTemplate, templateId, name, onSavedId]);

  const publish = useCallback(async (): Promise<void> => {
    const errs = graphIssues.filter((i) => i.severity === 'error');
    if (errs.length) {
      setError(errs.map((e) => e.message).join('; '));
      return;
    }
    const id = await saveDraft();
    if (!id) return;
    setBusy(true);
    try {
      const pub = await api.post<WorkflowTemplateDetail>(`/workflow-templates/${id}/publish`);
      setStatus(pub.status);
      setVersion(pub.latestVersion);
      message.success('Опубликовано');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [graphIssues, saveDraft]);

  const testRun = useCallback(async (): Promise<string | null> => {
    const errs = graphIssues.filter((i) => i.severity === 'error');
    if (errs.length) {
      setError(errs.map((e) => e.message).join('; '));
      return null;
    }
    const id = await saveDraft();
    if (!id) return null;
    setBusy(true);
    try {
      const task = await api.post<{ id: string }>(`/workflow-templates/${id}/test-run`, {});
      message.success('Тест-запуск создан');
      return task.id;
    } catch (e) {
      setError(errMsg(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [graphIssues, saveDraft]);

  const selectedNode = nodes.find((n) => n.id === selectedId);

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    updateNode,
    removeNode,
    selectedId,
    setSelectedId,
    selectedNode,
    name,
    setName,
    status,
    version,
    templateId,
    busy,
    error,
    setError,
    graphIssues,
    saveDraft,
    publish,
    testRun,
  };
}
