/**
 * Shared contract for WorkflowTemplate JSON. BROWSER-SAFE (zod only, no IO,
 * no Temporal). Imported by both the web Visual Builder and the workflow engine.
 */
import { z } from 'zod';

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  toolRef: z.string().optional(),
  params: z.record(z.unknown()).default({}),
});

export const WorkflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const WorkflowTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().nonnegative().default(1),
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;
