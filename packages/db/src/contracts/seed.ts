/**
 * Dev/seed-метаданные провайдеров и моделей. БЕЗ СЕКРЕТОВ: хранятся только имена
 * secret-references (env/secret store), никаких base URL и токенов в значениях.
 *
 * Embedding-провайдеры ОТДЕЛЕНЫ от chat/vision/extraction-моделей. LM Studio
 * модели (chandra-ocr-2/lift/qwen36-27b-mtp) НЕ являются embedding-провайдерами.
 */
import type { ProviderType } from './providers.js';

export interface ModelSeed {
  modelId: string;
  purpose: string;
  contextWindow?: number;
  maxParallelRequests?: number;
  supportsVision: boolean;
  supportsJsonExtraction: boolean;
  supportsEmbeddings: boolean;
  embeddingDim?: number;
  notes?: string;
}

export interface ProviderSeed {
  key: string;
  providerType: ProviderType;
  displayName: string;
  enabled: boolean;
  localOnly: boolean;
  cloudAllowed: boolean;
  /** Имена secret-references (НЕ значения). */
  baseUrlSecretRef?: string;
  apiTokenSecretRef?: string;
  configSecretRef?: string;
  auditLevel: string;
  models: ModelSeed[];
}

/** LM Studio (локальный сервер): OCR/extraction/analysis. Не embeddings. */
export const lmStudioProviderSeed: ProviderSeed = {
  key: 'lmstudio-local',
  providerType: 'lmstudio',
  displayName: 'LM Studio (локальный сервер)',
  enabled: false,
  localOnly: true,
  cloudAllowed: false,
  baseUrlSecretRef: 'LLM_STUDIO_BASE_URL',
  apiTokenSecretRef: 'LLM_STUDIO_API_TOKEN',
  auditLevel: 'standard',
  models: [
    {
      modelId: 'chandra-ocr-2',
      purpose: 'ocr_markdown',
      contextWindow: 32768,
      maxParallelRequests: 4,
      supportsVision: true,
      supportsJsonExtraction: false,
      supportsEmbeddings: false,
      notes: 'OCR изображений/сканов/страниц PDF → Markdown',
    },
    {
      modelId: 'lift',
      purpose: 'json_extraction',
      contextWindow: 32768,
      maxParallelRequests: 4,
      supportsVision: true,
      supportsJsonExtraction: true,
      supportsEmbeddings: false,
      notes: 'Структурированное извлечение данных в JSON по схеме',
    },
    {
      modelId: 'qwen36-27b-mtp',
      purpose: 'analysis_long_context',
      contextWindow: 131072,
      maxParallelRequests: 1,
      supportsVision: false,
      supportsJsonExtraction: false,
      supportsEmbeddings: false,
      notes: 'Анализ/нормализация/классификация/длинный контекст',
    },
  ],
};

/**
 * Yandex Embeddings (768). НЕ обязательная зависимость (лабораторный вариант),
 * поэтому enabled=false. Только secret-ref имена.
 */
export const yandexEmbeddingProviderSeed: ProviderSeed = {
  key: 'yandex-embeddings',
  providerType: 'embedding_provider',
  displayName: 'Yandex Embeddings (768)',
  enabled: false,
  localOnly: false,
  cloudAllowed: false,
  baseUrlSecretRef: 'YANDEX_EMBEDDING_ENDPOINT',
  apiTokenSecretRef: 'YANDEX_API_KEY',
  configSecretRef: 'YANDEX_FOLDER_ID',
  auditLevel: 'standard',
  models: [
    {
      modelId: 'yandex-text-embedding',
      purpose: 'embedding',
      supportsVision: false,
      supportsJsonExtraction: false,
      supportsEmbeddings: true,
      embeddingDim: 768,
      notes: 'Размерность 768 (текущий максимум Yandex)',
    },
  ],
};

/** Mock embedding-провайдер (1536) для unit-тестов. Не делает реальных вызовов. */
export const mockEmbeddingProviderSeed: ProviderSeed = {
  key: 'mock-embedding',
  providerType: 'embedding_provider',
  displayName: 'Mock Embedding (1536, для тестов)',
  enabled: false,
  localOnly: true,
  cloudAllowed: false,
  auditLevel: 'standard',
  models: [
    {
      modelId: 'mock-embed-1536',
      purpose: 'embedding',
      supportsVision: false,
      supportsJsonExtraction: false,
      supportsEmbeddings: true,
      embeddingDim: 1536,
      notes: 'Mock-провайдер эмбеддингов (1536) для локальных тестов',
    },
  ],
};

/** Все dev-seed провайдеры. */
export const PROVIDER_SEEDS: ProviderSeed[] = [
  lmStudioProviderSeed,
  yandexEmbeddingProviderSeed,
  mockEmbeddingProviderSeed,
];
