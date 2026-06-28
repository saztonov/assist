/**
 * Optional reranking. NODE-ONLY.
 *
 * The default is identity (no reorder). A real external reranker is allowed ONLY
 * through provider policy and must log metadata only (no raw sensitive text).
 */
export interface RerankItem {
  chunkId: string;
  content: string;
  score: number;
}

export interface Reranker {
  rerank(query: string, items: RerankItem[]): Promise<RerankItem[]>;
}

export const identityReranker: Reranker = {
  async rerank(_query: string, items: RerankItem[]): Promise<RerankItem[]> {
    return items;
  },
};
