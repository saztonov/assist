/**
 * Pure model routing. NODE-ONLY (no I/O).
 *
 * OCR/Markdown → chandra; strict JSON → lift; analysis/chat/long-context → qwen.
 */
import type { LlmGatewayConfig, ModelPurpose } from './types.js';

export type ModelBucket = 'chandra' | 'lift' | 'qwen';

/** Maps a concrete model id to its concurrency bucket (or undefined if unknown). */
export function bucketForModel(
  modelId: string,
  models: LlmGatewayConfig['models'],
): ModelBucket | undefined {
  if (modelId === models.chandra) return 'chandra';
  if (modelId === models.lift) return 'lift';
  if (modelId === models.qwen) return 'qwen';
  return undefined;
}

/** Default model for a task class (when the caller does not pin a model). */
export function modelForPurpose(purpose: ModelPurpose, cfg: LlmGatewayConfig): string {
  switch (purpose) {
    case 'ocr':
      return cfg.defaults.ocr;
    case 'extraction':
      return cfg.defaults.extraction;
    case 'analysis':
    case 'chat':
    case 'embedding':
    default:
      return cfg.defaults.chat;
  }
}
