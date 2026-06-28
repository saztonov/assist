/**
 * Secret resolution. NODE-ONLY.
 *
 * Provider/model registry rows store only `*_secret_ref` (never raw secrets).
 * This resolver maps a `secret_ref` to its actual value at runtime from
 * env/Lockbox. Fail-closed: an unknown/empty reference throws — and the secret
 * VALUE is never included in errors or logs.
 *
 * Reference convention: `"env:NAME"` or a bare `"NAME"` → `process.env[NAME]`.
 */
import { NotFoundError } from '@su10/errors';

export interface SecretResolver {
  /** Resolve a reference to its secret value, or throw if missing (fail-closed). */
  resolve(secretRef: string): string;
  /** Resolve or return undefined (no throw). */
  tryResolve(secretRef: string | null | undefined): string | undefined;
}

export function createEnvSecretResolver(env: NodeJS.ProcessEnv = process.env): SecretResolver {
  const lookup = (ref: string | null | undefined): string | undefined => {
    if (!ref) return undefined;
    const name = ref.startsWith('env:') ? ref.slice(4) : ref;
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    tryResolve: lookup,
    resolve(ref: string): string {
      const value = lookup(ref);
      if (value === undefined) {
        // Name only — NEVER the secret value.
        const name = ref.startsWith('env:') ? ref.slice(4) : ref;
        throw new NotFoundError('secret not found for reference', { secretRefName: name });
      }
      return value;
    },
  };
}
