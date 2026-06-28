/**
 * Token-aware chunker. NODE-ONLY, PURE (no I/O).
 *
 * Produces stable, idempotent chunks: same input + same `CHUNKER_VERSION` →
 * identical `chunkHash`/`sourceTextHash`. `contentOriginal` is the raw chunk text
 * (for display/citations); `contentEmbedding` is enriched with ACL-allowed
 * metadata (title/documentType/project) for better retrieval. Bump
 * `CHUNKER_VERSION` whenever chunking logic changes (drives re-indexing).
 */
import { createHash } from 'node:crypto';

export const CHUNKER_VERSION = 'v1';

export interface PageSpan {
  page: number;
  charStart: number;
  charEnd: number;
}

export interface ChunkInput {
  /** Normalized text/markdown of the whole document version. */
  text: string;
  /** ACL-allowed metadata used to enrich `contentEmbedding` (optional). */
  title?: string;
  documentType?: string;
  projectId?: string;
  /** Optional char→page mapping for citation page ranges. */
  pages?: PageSpan[];
}

export interface ChunkOptions {
  /** Approx tokens per chunk (word-based heuristic). */
  maxTokens?: number;
  /** Tokens of overlap between consecutive chunks. */
  overlapTokens?: number;
}

export interface Chunk {
  chunkIndex: number;
  contentOriginal: string;
  contentEmbedding: string;
  tokenCount: number;
  charStart: number;
  charEnd: number;
  pageFrom?: number;
  pageTo?: number;
  sourceTextHash: string;
  chunkHash: string;
  chunkerVersion: string;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function tokenize(text: string): Word[] {
  const words: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    words.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return words;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function pageRangeFor(
  charStart: number,
  charEnd: number,
  pages: PageSpan[] | undefined,
): { pageFrom?: number; pageTo?: number } {
  if (!pages?.length) return {};
  const overlapping = pages.filter((p) => p.charStart < charEnd && p.charEnd > charStart);
  if (!overlapping.length) return {};
  return {
    pageFrom: Math.min(...overlapping.map((p) => p.page)),
    pageTo: Math.max(...overlapping.map((p) => p.page)),
  };
}

function enrich(content: string, input: ChunkInput): string {
  const header: string[] = [];
  if (input.title) header.push(`Заголовок: ${input.title}`);
  if (input.documentType) header.push(`Тип: ${input.documentType}`);
  if (input.projectId) header.push(`Проект: ${input.projectId}`);
  return header.length ? `${header.join('\n')}\n\n${content}` : content;
}

/** Splits a normalized document into overlapping, token-bounded chunks. */
export function chunkDocument(input: ChunkInput, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = Math.max(1, opts.maxTokens ?? 350);
  const overlap = Math.max(0, Math.min(opts.overlapTokens ?? 50, maxTokens - 1));
  const sourceTextHash = sha256(input.text);
  const words = tokenize(input.text);
  if (words.length === 0) return [];

  const step = maxTokens - overlap;
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (let i = 0; i < words.length; i += step) {
    const window = words.slice(i, i + maxTokens);
    if (window.length === 0) break;
    const charStart = window[0].start;
    const charEnd = window[window.length - 1].end;
    const contentOriginal = input.text.slice(charStart, charEnd);
    const contentEmbedding = enrich(contentOriginal, input);
    const { pageFrom, pageTo } = pageRangeFor(charStart, charEnd, input.pages);
    chunks.push({
      chunkIndex,
      contentOriginal,
      contentEmbedding,
      tokenCount: window.length,
      charStart,
      charEnd,
      ...(pageFrom !== undefined ? { pageFrom } : {}),
      ...(pageTo !== undefined ? { pageTo } : {}),
      sourceTextHash,
      chunkHash: sha256(`${CHUNKER_VERSION}\n${chunkIndex}\n${contentOriginal}`),
      chunkerVersion: CHUNKER_VERSION,
    });
    chunkIndex++;
    if (i + maxTokens >= words.length) break;
  }
  return chunks;
}
