/**
 * Source-portal derivation. The authoritative signal is the verified token's
 * `azp` (the Keycloak client of the calling portal). The X-Source-Portal header
 * is client-controlled telemetry only and never grants anything by itself.
 */

function allowed(value: string, allowlist?: string[]): boolean {
  return !allowlist || allowlist.length === 0 || allowlist.includes(value);
}

/** Authoritative: derive from the verified `azp`, gated by the allowlist. */
export function derivePortalFromAzp(
  azp: string | undefined,
  allowlist?: string[],
): string | undefined {
  if (!azp) return undefined;
  return allowed(azp, allowlist) ? azp : undefined;
}

/** Telemetry hint: accept the header value only if it passes the allowlist. */
export function portalFromHeader(
  header: string | undefined,
  allowlist?: string[],
): string | undefined {
  if (!header) return undefined;
  return allowed(header, allowlist) ? header : undefined;
}
