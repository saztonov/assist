import { describe, it, expect } from 'vitest';
import { WorkflowTemplateSchema } from './index.js';

describe('WorkflowTemplateSchema', () => {
  it('accepts a minimal valid template', () => {
    const r = WorkflowTemplateSchema.safeParse({ id: 't1', name: 'Sample' });
    expect(r.success).toBe(true);
  });

  it('rejects a template missing id/name', () => {
    expect(WorkflowTemplateSchema.safeParse({ nodes: [] }).success).toBe(false);
  });
});
