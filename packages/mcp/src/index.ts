/** Managed MCP registry: allowlist + per-server permissions + audit. NODE-ONLY. */
import type { RiskLevel } from '@su10/permissions';

export interface McpServerDescriptor {
  id: string;
  url: string;
  allowed: boolean;
  riskLevel: RiskLevel;
}

export class McpRegistry {
  private readonly servers = new Map<string, McpServerDescriptor>();
  private readonly allowlist = new Set<string>();

  register(desc: McpServerDescriptor): void {
    this.servers.set(desc.id, desc);
    if (desc.allowed) this.allowlist.add(desc.id);
  }

  /** Non-allowlisted MCP servers MUST NOT be callable. */
  isAllowed(id: string): boolean {
    return this.allowlist.has(id);
  }

  get(id: string): McpServerDescriptor | undefined {
    return this.servers.get(id);
  }

  list(): McpServerDescriptor[] {
    return [...this.servers.values()];
  }
}
