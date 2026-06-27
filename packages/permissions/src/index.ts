/** Authorization primitives: subjects, risk levels, approval policy. */
import { z } from 'zod';

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export interface Subject {
  id: string;
  roles: string[];
}

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

export interface ApprovalPolicy {
  requiresApproval(risk: RiskLevel): boolean;
}

export const defaultApprovalPolicy: ApprovalPolicy = {
  requiresApproval: (risk) => risk === 'high',
};

/**
 * Scaffold stub. Real object-level authorization (department, contractor,
 * document, workflow status) is enforced on the backend at the data boundary.
 */
export function can(subject: Subject, action: string, _resource?: string): PermissionDecision {
  const allowed = subject.roles.includes('admin') || subject.roles.includes(action);
  return allowed ? { allowed: true } : { allowed: false, reason: 'no matching role' };
}
