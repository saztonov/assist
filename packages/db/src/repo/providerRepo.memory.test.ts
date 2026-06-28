import { describe, it, expect } from 'vitest';
import { InMemoryProviderRepo } from './providerRepo.js';

describe('InMemoryProviderRepo', () => {
  it('creates and updates a provider (secret_ref only)', async () => {
    const repo = new InMemoryProviderRepo();
    const p = await repo.createProvider({
      providerType: 'lmstudio',
      displayName: 'LM Studio',
      apiTokenSecretRef: 'env:TOKEN',
    });
    expect(p.enabled).toBe(false);
    expect(p.apiTokenSecretRef).toBe('env:TOKEN');
    const updated = await repo.updateProvider(p.id, { enabled: true });
    expect(updated?.enabled).toBe(true);
    expect(await repo.listProviders()).toHaveLength(1);
  });

  it('creates models scoped to a provider', async () => {
    const repo = new InMemoryProviderRepo();
    const p = await repo.createProvider({ providerType: 'lmstudio', displayName: 'LM' });
    await repo.createModel({ providerId: p.id, modelId: 'qwen36-27b-mtp', purpose: 'analysis' });
    await repo.createModel({ providerId: p.id, modelId: 'lift', purpose: 'extraction' });
    expect(await repo.listModels(p.id)).toHaveLength(2);
    expect(await repo.listModels('other')).toHaveLength(0);
  });

  it('creates and updates policies', async () => {
    const repo = new InMemoryProviderRepo();
    const pol = await repo.createPolicy({ name: 'p', dataClass: 'pii', decision: 'deny' });
    expect(pol.enabled).toBe(true);
    const upd = await repo.updatePolicy(pol.id, { enabled: false });
    expect(upd?.enabled).toBe(false);
  });
});
