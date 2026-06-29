import { describe, it, expect } from 'vitest';
import { InMemoryWorkflowTemplateRepo, templateChecksum } from './workflowTemplateRepo.js';

const DEF_A = { id: 't', name: 'n', version: 1, nodes: [{ id: 'a', type: 'manual_trigger' }], edges: [] };
const DEF_B = {
  id: 't',
  name: 'n',
  version: 1,
  nodes: [
    { id: 'a', type: 'manual_trigger' },
    { id: 'b', type: 'tool', toolRef: 'rag.search' },
  ],
  edges: [{ from: 'a', to: 'b' }],
};

describe('InMemoryWorkflowTemplateRepo', () => {
  it('create → v1 draft, latest set, status draft', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    const { template, version } = await repo.createTemplate({
      createdBy: 'u1',
      name: 'Мой шаблон',
      definition: DEF_A,
    });
    expect(template.status).toBe('draft');
    expect(version.version).toBe(1);
    expect(template.latestVersionId).toBe(version.id);
    expect(version.checksum).toBe(templateChecksum(DEF_A));
  });

  it('generates unique keys for same-name templates', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    const a = await repo.createTemplate({ createdBy: 'u1', name: 'Same', definition: DEF_A });
    const b = await repo.createTemplate({ createdBy: 'u1', name: 'Same', definition: DEF_A });
    expect(a.template.key).not.toBe(b.template.key);
  });

  it('falls back to "template" key for non-sluggable names', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    const { template } = await repo.createTemplate({ createdBy: 'u1', name: '!!!', definition: DEF_A });
    expect(template.key).toBe('template');
  });

  it('saveDraft on a draft overwrites the current version (no version bump)', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    const { template } = await repo.createTemplate({ createdBy: 'u1', name: 'X', definition: DEF_A });
    const { version } = await repo.saveDraft({ templateId: template.id, definition: DEF_B });
    expect(version.version).toBe(1);
    expect(version.checksum).toBe(templateChecksum(DEF_B));
    expect(repo.versions.filter((v) => v.templateId === template.id)).toHaveLength(1);
  });

  it('publish marks template published, keeps current version', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    const { template, version } = await repo.createTemplate({
      createdBy: 'u1',
      name: 'X',
      definition: DEF_B,
    });
    const published = await repo.publish({ templateId: template.id });
    expect(published.template.status).toBe('published');
    expect(published.version.id).toBe(version.id);
  });

  it('saveDraft after publish forks vN+1 draft and flips status to draft', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    const { template } = await repo.createTemplate({ createdBy: 'u1', name: 'X', definition: DEF_A });
    await repo.publish({ templateId: template.id });
    const { template: forked, version } = await repo.saveDraft({
      templateId: template.id,
      definition: DEF_B,
    });
    expect(version.version).toBe(2);
    expect(forked.status).toBe('draft');
    expect(forked.latestVersionId).toBe(version.id);
    // Замороженная v1 по-прежнему доступна.
    const v1 = await repo.getVersion(template.id, 1);
    expect(v1?.definitionJson).toEqual(DEF_A);
  });

  it('getTemplateById returns the latest version definition', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    const { template } = await repo.createTemplate({ createdBy: 'u1', name: 'X', definition: DEF_A });
    await repo.saveDraft({ templateId: template.id, definition: DEF_B });
    const got = await repo.getTemplateById(template.id);
    expect(got?.version.definitionJson).toEqual(DEF_B);
  });

  it('listTemplates scopes by owner unless admin', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    await repo.createTemplate({ createdBy: 'u1', name: 'A', definition: DEF_A });
    await repo.createTemplate({ createdBy: 'u2', name: 'B', definition: DEF_A });
    const owner = await repo.listTemplates({ requesterId: 'u1', isAdmin: false, limit: 20 });
    expect(owner.items).toHaveLength(1);
    expect(owner.items[0]?.createdBy).toBe('u1');
    const admin = await repo.listTemplates({ requesterId: 'u1', isAdmin: true, limit: 20 });
    expect(admin.items).toHaveLength(2);
  });

  it('listTemplates paginates with a cursor', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    for (let i = 0; i < 3; i += 1) {
      await repo.createTemplate({ createdBy: 'u1', name: `T${i}`, definition: DEF_A });
    }
    const page1 = await repo.listTemplates({ requesterId: 'u1', isAdmin: false, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();
  });

  it('recordRun then updateRunStatus transitions the run', async () => {
    const repo = new InMemoryWorkflowTemplateRepo();
    const { template, version } = await repo.createTemplate({
      createdBy: 'u1',
      name: 'X',
      definition: DEF_A,
    });
    const run = await repo.recordRun({
      templateId: template.id,
      templateVersionId: version.id,
      taskId: 'task-1',
    });
    expect(run.status).toBe('pending');
    const started = await repo.updateRunStatus({
      runId: run.id,
      status: 'started',
      workflowId: 'agent-task-task-1',
      startedAt: new Date(),
    });
    expect(started.status).toBe('started');
    expect(started.workflowId).toBe('agent-task-task-1');
  });
});
