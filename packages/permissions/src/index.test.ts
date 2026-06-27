import { describe, it, expect } from 'vitest';
import { can, defaultApprovalPolicy } from './index.js';

describe('permissions', () => {
  it('high-risk actions require approval, low-risk do not', () => {
    expect(defaultApprovalPolicy.requiresApproval('high')).toBe(true);
    expect(defaultApprovalPolicy.requiresApproval('low')).toBe(false);
  });

  it('allows a subject with a matching role and denies otherwise', () => {
    expect(can({ id: 'u', roles: ['echo'] }, 'echo').allowed).toBe(true);
    expect(can({ id: 'u', roles: [] }, 'echo').allowed).toBe(false);
  });
});
