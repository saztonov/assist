/**
 * Статический каталог блоков визуального конструктора (12 базовых блоков) +
 * аугментация живыми инструментами из GET /tools. Чистый модуль (без IO, без
 * @xyflow/react) — юнит-тестируемый.
 *
 * Маппинг блоков на семантику движка (runVisualTemplate):
 *  - type начинается с "trigger" → no-op триггер;
 *  - type === "agent" → runAgentBlock (agentName из params.agentName);
 *  - type === "approval" → approval-гейт;
 *  - иначе tool-блок: имя инструмента = toolRef ?? type, params = вход.
 */
import type { ToolMetadata } from './types.js';

export type ParamKind = 'text' | 'number' | 'select' | 'switch' | 'textarea';

export interface ParamField {
  name: string;
  label: string;
  kind: ParamKind;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
}

export type BlockGroup =
  | 'Триггеры'
  | 'Почта'
  | 'Документы'
  | 'Агенты'
  | 'Артефакты'
  | 'Контроль'
  | 'Уведомления'
  | 'Инструменты';

export interface BlockDef {
  key: string;
  label: string;
  group: BlockGroup;
  /** node.type для движка. */
  nodeType: string;
  /** Имя инструмента (tool-блоки). */
  toolRef?: string;
  /** Имя агента (agent-блоки) — кладётся в params.agentName при map-out. */
  agentName?: string;
  paramFields: ParamField[];
  description?: string;
  /** Аугментация из живого Tool Registry. */
  riskLevel?: string;
  requiresApproval?: boolean;
  /** true, если для блока есть зарегистрированный инструмент (для предупреждений). */
  available?: boolean;
}

const t = (name: string, label: string, required = false, placeholder?: string): ParamField => ({
  name,
  label,
  kind: 'text',
  required,
  ...(placeholder ? { placeholder } : {}),
});
const area = (name: string, label: string, required = false): ParamField => ({
  name,
  label,
  kind: 'textarea',
  required,
});
const num = (name: string, label: string): ParamField => ({ name, label, kind: 'number' });

export const BASE_BLOCKS: BlockDef[] = [
  { key: 'manual_trigger', label: 'Manual Trigger', group: 'Триггеры', nodeType: 'manual_trigger', paramFields: [], description: 'Ручной запуск' },
  {
    key: 'schedule_trigger',
    label: 'Schedule Trigger',
    group: 'Триггеры',
    nodeType: 'schedule_trigger',
    paramFields: [t('cron', 'CRON', true, '0 9 * * 1-5')],
    description: 'Запуск по расписанию',
  },
  {
    key: 'mail_search',
    label: 'Search Mail',
    group: 'Почта',
    nodeType: 'tool',
    toolRef: 'mail.search',
    paramFields: [t('connector_account_id', 'Подключение', true), t('subject', 'Тема'), t('text', 'Текст'), num('limit', 'Лимит')],
  },
  {
    key: 'mail_attachments',
    label: 'Download Attachments',
    group: 'Почта',
    nodeType: 'tool',
    toolRef: 'mail.save_attachments_to_s3',
    paramFields: [t('connector_account_id', 'Подключение', true), t('uid', 'UID письма', true), t('mailbox', 'Папка')],
  },
  {
    key: 'parse_document',
    label: 'Parse Document',
    group: 'Документы',
    nodeType: 'agent',
    agentName: 'document_extraction_agent',
    paramFields: [t('sourceRef', 'Документ (ref)', true), area('prompt', 'Инструкция')],
    description: 'Парсинг документа (требует ссылку на документ/вложение)',
  },
  {
    key: 'rag_search',
    label: 'RAG Search',
    group: 'Документы',
    nodeType: 'tool',
    toolRef: 'rag.search',
    paramFields: [t('query', 'Запрос', true), num('k', 'Top-K')],
  },
  {
    key: 'agent_extract',
    label: 'Agent: Extract Structured Data',
    group: 'Агенты',
    nodeType: 'agent',
    agentName: 'document_extraction_agent',
    paramFields: [area('prompt', 'Инструкция', true), area('schemaHint', 'Схема (подсказка)')],
  },
  {
    key: 'agent_summarize',
    label: 'Agent: Summarize',
    group: 'Агенты',
    nodeType: 'agent',
    agentName: 'chat_agent',
    paramFields: [area('prompt', 'Промпт', true)],
  },
  {
    key: 'create_xlsx',
    label: 'Create XLSX',
    group: 'Артефакты',
    nodeType: 'tool',
    toolRef: 'artifact.create',
    paramFields: [t('name', 'Имя файла', true), { name: 'artifactType', label: 'Тип', kind: 'text' }],
    description: 'Регистрирует XLSX-артефакт (контент формируется backend/worker)',
  },
  {
    key: 'create_report',
    label: 'Create Report',
    group: 'Артефакты',
    nodeType: 'tool',
    toolRef: 'artifact.create',
    paramFields: [t('name', 'Заголовок', true), { name: 'artifactType', label: 'Тип', kind: 'text' }],
    description: 'Регистрирует отчёт-артефакт',
  },
  {
    key: 'request_approval',
    label: 'Request Approval',
    group: 'Контроль',
    nodeType: 'approval',
    paramFields: [area('message', 'Сообщение', true), t('approverRole', 'Роль аппрувера')],
    description: 'Пауза до решения approval',
  },
  {
    key: 'notify_user',
    label: 'Notify User',
    group: 'Уведомления',
    nodeType: 'tool',
    toolRef: 'notification.send',
    paramFields: [t('to', 'Кому', true), t('subject', 'Тема', true), area('body', 'Текст', true)],
  },
];

/** JSON Schema property → ParamField (best-effort). */
function fieldFromJsonSchemaProp(
  name: string,
  prop: Record<string, unknown>,
  required: boolean,
): ParamField {
  const type = prop.type;
  if (Array.isArray(prop.enum)) {
    return {
      name,
      label: name,
      kind: 'select',
      required,
      options: prop.enum.map((v) => ({ label: String(v), value: String(v) })),
    };
  }
  if (type === 'number' || type === 'integer') return { name, label: name, kind: 'number', required };
  if (type === 'boolean') return { name, label: name, kind: 'switch', required };
  return { name, label: name, kind: 'text', required };
}

/** Выводит paramFields из top-level properties JSON Schema инструмента. */
export function deriveParamFields(inputSchema: unknown): ParamField[] {
  if (!inputSchema || typeof inputSchema !== 'object') return [];
  const schema = inputSchema as Record<string, unknown>;
  const props = schema.properties;
  if (!props || typeof props !== 'object') return [];
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(props as Record<string, Record<string, unknown>>).map(([name, prop]) =>
    fieldFromJsonSchemaProp(name, prop, required.has(name)),
  );
}

export interface MergedCatalog {
  catalog: BlockDef[];
  toolByRef: Record<string, ToolMetadata>;
}

/**
 * Аугментирует базовые блоки живыми метаданными инструментов и добавляет инструменты,
 * не покрытые базовыми блоками, отдельной группой «Инструменты».
 */
export function mergeLiveTools(base: BlockDef[], tools: ToolMetadata[]): MergedCatalog {
  const toolByRef: Record<string, ToolMetadata> = {};
  for (const tool of tools) toolByRef[tool.name] = tool;

  const catalog: BlockDef[] = base.map((block) => {
    if (!block.toolRef) return { ...block, available: true };
    const tool = toolByRef[block.toolRef];
    if (!tool) return { ...block, available: false };
    return {
      ...block,
      available: true,
      riskLevel: tool.riskLevel,
      requiresApproval: tool.requiresApproval,
      description: block.description ?? tool.description,
    };
  });

  const coveredRefs = new Set(base.map((b) => b.toolRef).filter(Boolean) as string[]);
  for (const tool of tools) {
    if (coveredRefs.has(tool.name)) continue;
    catalog.push({
      key: `tool:${tool.name}`,
      label: tool.name,
      group: 'Инструменты',
      nodeType: 'tool',
      toolRef: tool.name,
      paramFields: deriveParamFields(tool.inputSchema),
      description: tool.description,
      riskLevel: tool.riskLevel,
      requiresApproval: tool.requiresApproval,
      available: true,
    });
  }
  return { catalog, toolByRef };
}

/** Найти определение блока по узлу шаблона (для обратного маппинга). */
export function matchBlockKey(node: {
  type: string;
  toolRef?: string;
  agentName?: string;
}): string | undefined {
  const lower = node.type.toLowerCase();
  if (lower.includes('trigger')) {
    return BASE_BLOCKS.find((b) => b.nodeType === node.type)?.key ?? 'manual_trigger';
  }
  if (lower === 'approval') return 'request_approval';
  if (lower === 'agent') {
    return BASE_BLOCKS.find((b) => b.nodeType === 'agent' && b.agentName === node.agentName)?.key;
  }
  return BASE_BLOCKS.find((b) => b.toolRef === node.toolRef)?.key ?? `tool:${node.toolRef ?? node.type}`;
}
