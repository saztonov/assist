/**
 * Pure model policy. NODE-ONLY (no I/O).
 *
 * Governs which models/providers a task may use: allowlist, task→model mapping,
 * localOnly/sensitive-data policy and optional fallback. Portals never see
 * provider details — they go through the gateway, which applies this policy.
 */
import { AuthzError, ValidationError } from '@su10/errors';
import type { ProviderPolicy, TaskKind } from './types.js';

export interface ModelPolicy {
  /** Empty = no allowlist restriction. */
  allowedModels: string[];
  /** Preferred model per task class. */
  taskModel: Partial<Record<TaskKind, string>>;
  /** Empty = no provider restriction. */
  providerAllowlist: string[];
  localOnly: boolean;
  sensitiveDataPolicy: 'block' | 'allow' | 'redact';
  fallbackModel?: string;
}

export interface ResolveModelInput {
  task: TaskKind;
  requestedModel?: string;
}

/**
 * Resolve the effective model for a task. Throws `ValidationError` if no model
 * can be resolved and `AuthzError` if the candidate is not allowed (and no
 * allowed fallback exists).
 */
export function resolveModel(policy: ModelPolicy, input: ResolveModelInput): { model: string } {
  const candidate = input.requestedModel ?? policy.taskModel[input.task] ?? policy.fallbackModel;
  if (!candidate) {
    throw new ValidationError(`no model resolved for task "${input.task}"`);
  }
  if (policy.allowedModels.length > 0 && !policy.allowedModels.includes(candidate)) {
    if (policy.fallbackModel && policy.allowedModels.includes(policy.fallbackModel)) {
      return { model: policy.fallbackModel };
    }
    throw new AuthzError(`model not allowed by policy`);
  }
  return { model: candidate };
}

/** Whether a provider is allowed to receive data of the given sensitivity. */
export function providerAllowsData(
  policy: ProviderPolicy,
  opts: { sensitive: boolean; isLocal: boolean },
): boolean {
  if (opts.sensitive && policy.sensitiveDataPolicy === 'block') return false;
  if (policy.localOnly && !opts.isLocal) return false;
  if (!opts.isLocal && !policy.cloudAllowed) return false;
  return true;
}
