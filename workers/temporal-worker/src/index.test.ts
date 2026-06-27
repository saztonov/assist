import { describe, it, expect } from 'vitest';
import { runWorker, createActivities } from './index.js';

describe('temporal-worker', () => {
  it('builds activities and runs the workflow without network I/O', async () => {
    expect(typeof createActivities().recordTaskStatus).toBe('function');
    await expect(runWorker()).resolves.toBeUndefined();
  });
});
