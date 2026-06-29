/** zod-контракты запросов/ответов Workflow Templates + мапперы строк БД в DTO. */
import { z } from 'zod';
import { WorkflowTemplateSchema } from '@su10/workflow-schema';
import type { WorkflowTemplateRow, WorkflowTemplateVersionRow } from '@su10/db';

export const WorkflowTemplateStatusSchema = z.enum(['draft', 'published']);

// ---- requests ----
export const CreateTemplateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Опционально: если не передано — создаётся пустой draft. */
  definition: WorkflowTemplateSchema.optional(),
});

export const SaveDraftBody = z.object({
  definition: WorkflowTemplateSchema,
});

export const TestRunBody = z.object({
  inputJson: z.record(z.unknown()).optional(),
});

export const TemplateIdParams = z.object({ id: z.string().uuid() });

export const ListTemplatesQuery = z.object({
  status: WorkflowTemplateStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

// ---- responses ----
export const TemplateCardSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: WorkflowTemplateStatusSchema,
  latestVersion: z.number().int(),
  /** WorkflowTemplate JSON (фронт ревалидирует через @su10/workflow-schema). */
  definition: z.unknown(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TemplateSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: WorkflowTemplateStatusSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ListTemplatesResponse = z.object({
  items: z.array(TemplateSummarySchema),
  nextCursor: z.string().optional(),
});

export type TemplateCard = z.infer<typeof TemplateCardSchema>;
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

// ---- mappers (row → DTO) ----
export function toTemplateCard(
  template: WorkflowTemplateRow,
  version: WorkflowTemplateVersionRow,
): TemplateCard {
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    description: template.description,
    status: template.status as 'draft' | 'published',
    latestVersion: version.version,
    definition: version.definitionJson,
    createdBy: template.createdBy,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

export function toTemplateSummary(template: WorkflowTemplateRow): TemplateSummary {
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    description: template.description,
    status: template.status as 'draft' | 'published',
    createdBy: template.createdBy,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
