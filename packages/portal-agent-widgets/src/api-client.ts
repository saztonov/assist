/**
 * Backend API client for embeddable widgets. Browser-safe, no antd/React.
 * Widgets receive an injected client (NOT raw service tokens) and talk ONLY to
 * the portal backend API.
 */
export interface AgentApiClient {
  getTask(id: string): Promise<unknown>;
}

export function createAgentApiClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): AgentApiClient {
  return {
    async getTask(id: string): Promise<unknown> {
      const res = await fetchImpl(`${baseUrl}/api/v1/tasks/${encodeURIComponent(id)}`);
      return res.json();
    },
  };
}
