import { describe, it, expect } from 'vitest';
import { isAdmin, canViewTemplate, canEditTemplate } from './access.js';

const owner = { sub: 'u-1', roles: [] };
const admin = { sub: 'admin-1', roles: ['admin'] };
const other = { sub: 'u-2', roles: [] };
const tpl = { createdBy: 'u-1' };

describe('workflow-templates access', () => {
  it('isAdmin reflects the admin role', () => {
    expect(isAdmin(['admin'])).toBe(true);
    expect(isAdmin([])).toBe(false);
  });

  it('owner and admin can view; others cannot', () => {
    expect(canViewTemplate(owner, tpl)).toBe(true);
    expect(canViewTemplate(admin, tpl)).toBe(true);
    expect(canViewTemplate(other, tpl)).toBe(false);
  });

  it('edit mirrors view (owner + admin)', () => {
    expect(canEditTemplate(owner, tpl)).toBe(true);
    expect(canEditTemplate(admin, tpl)).toBe(true);
    expect(canEditTemplate(other, tpl)).toBe(false);
  });
});
