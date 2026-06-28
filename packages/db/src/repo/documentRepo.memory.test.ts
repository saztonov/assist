import { describe, it, expect } from 'vitest';
import { InMemoryDocumentRepo, buildAclEntries } from './documentRepo.js';

describe('buildAclEntries', () => {
  it('always includes an owner admin entry and de-duplicates', () => {
    const entries = buildAclEntries('u-1', [
      { principalType: 'role', principalId: 'finance', permission: 'read' },
      { principalType: 'role', principalId: 'finance', permission: 'read' },
    ]);
    expect(entries).toContainEqual({ principalType: 'user', principalId: 'u-1', permission: 'admin' });
    expect(entries.filter((e) => e.principalId === 'finance')).toHaveLength(1);
  });
});

describe('InMemoryDocumentRepo', () => {
  it('creates an upload session in pending_upload with version 1 + owner ACL', async () => {
    const repo = new InMemoryDocumentRepo();
    const { document, version } = await repo.createUploadSession({
      ownerUserId: 'u-1',
      createdBy: 'u-1',
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      storageKey: 'documents/x/a.pdf',
      title: 'Акт',
    });
    expect(document.status).toBe('pending_upload');
    expect(version.version).toBe(1);
    expect(version.storageKey).toBe('documents/x/a.pdf');
    const acl = await repo.listAcl(document.id);
    expect(acl.some((a) => a.principalType === 'user' && a.principalId === 'u-1')).toBe(true);
  });

  it('confirmUpload flips to uploaded and enqueues a pending parse job', async () => {
    const repo = new InMemoryDocumentRepo();
    const { document, version } = await repo.createUploadSession({
      ownerUserId: 'u-1',
      createdBy: 'u-1',
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      storageKey: 'k',
    });
    const { document: confirmed, parseJob } = await repo.confirmUpload({
      documentId: document.id,
      documentVersionId: version.id,
      sizeBytes: 100,
      contentHash: 'h',
    });
    expect(confirmed.status).toBe('uploaded');
    expect(confirmed.contentHash).toBe('h');
    expect(parseJob.status).toBe('pending');
    expect((await repo.getLatestVersion(document.id))?.sizeBytes).toBe(100);
  });

  it('setStatus transitions through indexing/indexed', async () => {
    const repo = new InMemoryDocumentRepo();
    const { document } = await repo.createUploadSession({
      ownerUserId: 'u-1',
      createdBy: 'u-1',
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      storageKey: 'k',
    });
    expect((await repo.setStatus(document.id, 'indexing')).status).toBe('indexing');
    expect((await repo.setStatus(document.id, 'indexed')).status).toBe('indexed');
  });
});
