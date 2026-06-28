import { describe, it, expect } from 'vitest';
import { buildRagQuery } from './ragQuery.js';

const base = {
  subjectId: 'u1',
  query: 'зарплата отчёт',
  aclScope: ['dept:hr'],
  permissionDecision: { allowed: true },
};

describe('buildRagQuery: ACL-before-retrieval (fail-closed)', () => {
  it('пустой aclScope → отклоняется', () => {
    expect(() => buildRagQuery({ ...base, aclScope: [] })).toThrow();
  });

  it('отсутствует permissionDecision → отклоняется', () => {
    expect(() => buildRagQuery({ subjectId: 'u1', query: 'q', aclScope: ['a'] })).toThrow();
  });

  it('permission denied → отклоняется', () => {
    expect(() => buildRagQuery({ ...base, permissionDecision: { allowed: false } })).toThrow();
  });

  it('scope + allowed → row-safe shape без сырого текста запроса', () => {
    const row = buildRagQuery(base);
    expect(row.permissionDecision).toBe('allowed');
    expect(row.aclScope).toEqual(['dept:hr']);
    expect(row.subjectId).toBe('u1');
    expect(row.queryHash).toMatch(/^[a-f0-9]{64}$/);
    // сырой текст запроса не должен попадать в строку телеметрии
    expect(JSON.stringify(row)).not.toContain('зарплата');
  });
});
