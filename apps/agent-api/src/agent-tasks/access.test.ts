import { describe, it, expect } from 'vitest';
import { canCancelTask, canViewTask, isAdmin } from './access.js';

const owner = { sub: 'u-1', roles: [] as string[] };
const admin = { sub: 'a', roles: ['admin'] };
const other = { sub: 'u-2', roles: [] as string[] };
const task = { createdBy: 'u-1' };

describe('agent-tasks access (владелец + admin)', () => {
  it('владелец видит и отменяет свою задачу', () => {
    expect(canViewTask(owner, task)).toBe(true);
    expect(canCancelTask(owner, task)).toBe(true);
  });

  it('admin видит и отменяет любую', () => {
    expect(canViewTask(admin, task)).toBe(true);
    expect(canCancelTask(admin, task)).toBe(true);
  });

  it('чужой не видит и не отменяет', () => {
    expect(canViewTask(other, task)).toBe(false);
    expect(canCancelTask(other, task)).toBe(false);
  });

  it('isAdmin', () => {
    expect(isAdmin(['admin'])).toBe(true);
    expect(isAdmin([])).toBe(false);
  });
});
