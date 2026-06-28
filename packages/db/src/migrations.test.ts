/**
 * SQL-инвариантные тесты (DB-FREE): читают файлы `drizzle/*.sql` и проверяют
 * структурные инварианты без подключения к БД/кластеру.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const drizzleDir = fileURLToPath(new URL('../drizzle/', import.meta.url));

const sqlFiles: Record<string, string> = {};
for (const f of readdirSync(drizzleDir)) {
  if (f.endsWith('.sql')) sqlFiles[f] = readFileSync(drizzleDir + f, 'utf8');
}
const allSql = Object.values(sqlFiles).join('\n');

/** Тело блока `CREATE TABLE <name> ( ... \n);` (без схемы или с `rag.`). */
function tableBlock(name: string): string {
  const re = new RegExp(`CREATE TABLE ${name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i');
  const m = allSql.match(re);
  return m ? m[1] : '';
}

function hasTable(name: string): boolean {
  return new RegExp(`CREATE TABLE ${name}\\s*\\(`, 'i').test(allSql);
}

/** Стоит ли колонка с именем `col` в блоке таблицы (точное совпадение имени). */
function hasColumn(block: string, col: string): boolean {
  return new RegExp(`^\\s*${col}\\s+\\w`, 'im').test(block);
}

const APP_TABLES = [
  'agent_tasks', 'agent_task_events', 'agent_task_artifacts',
  'chat_sessions', 'chat_messages',
  'workflow_templates', 'workflow_template_versions', 'workflow_runs',
  'approvals', 'approval_events',
  'agent_runs', 'agent_steps',
  'documents', 'document_versions', 'document_acl', 'document_parse_jobs',
  'llm_provider_registry', 'llm_provider_models', 'provider_policies',
  'provider_usage_events', 'provider_health_events', 'external_saas_providers',
  'llm_calls',
  'tool_definitions', 'tool_versions', 'tool_permissions', 'tool_call_logs',
  'tool_approval_policies',
  'mcp_servers', 'mcp_server_tools', 'mcp_server_permissions',
  'connector_accounts', 'connector_permissions', 'connector_tokens_metadata',
  'audit_events', 'outbox_events', 'postgres_jobs',
  'rag_indexes', 'rag_queries',
];

describe('app SQL миграции: состав таблиц', () => {
  for (const t of APP_TABLES) {
    it(`таблица ${t} создаётся`, () => {
      expect(hasTable(t)).toBe(true);
    });
  }

  it('audit_log не воссоздаётся (заменён audit_events)', () => {
    expect(hasTable('audit_log')).toBe(false);
  });
});

describe('app SQL: изоляция от PayHub-домена', () => {
  it('нет ссылок на public.letters / public.attachments / public.projects', () => {
    expect(/public\.letters/i.test(allSql)).toBe(false);
    expect(/public\.attachments/i.test(allSql)).toBe(false);
    expect(/public\.projects/i.test(allSql)).toBe(false);
  });
});

describe('app SQL: телеметрия без сырья', () => {
  const FORBIDDEN = ['prompt', 'content', 'token', 'raw_body', 'request_body', 'document_text', 'presigned_url'];
  for (const t of ['provider_usage_events', 'llm_calls', 'rag_queries']) {
    it(`${t} не содержит сырых колонок prompt/content/token/...`, () => {
      const block = tableBlock(t);
      expect(block.length).toBeGreaterThan(0);
      for (const f of FORBIDDEN) {
        expect(hasColumn(block, f)).toBe(false);
      }
    });
  }
});

describe('app SQL: провайдеры — только secret-ref, без сырых секретов', () => {
  const RAW_SECRETS = ['password', 'api_token', 'access_token', 'refresh_token', 'token', 'secret', 'base_url'];
  for (const t of ['llm_provider_registry', 'external_saas_providers', 'connector_accounts', 'connector_tokens_metadata', 'mcp_servers']) {
    it(`${t}: нет сырых секрет-колонок (только *_secret_ref)`, () => {
      const block = tableBlock(t);
      expect(block.length).toBeGreaterThan(0);
      for (const s of RAW_SECRETS) {
        expect(hasColumn(block, s)).toBe(false);
      }
    });
  }

  it('llm_provider_registry хранит base_url/api_token как secret-ref', () => {
    const block = tableBlock('llm_provider_registry');
    expect(hasColumn(block, 'base_url_secret_ref')).toBe(true);
    expect(hasColumn(block, 'api_token_secret_ref')).toBe(true);
  });
});

describe('app SQL: обязательные индексы (контракт)', () => {
  it('agent_tasks: status / created_by / workflow_id', () => {
    expect(/ON agent_tasks \(status\)/i.test(allSql)).toBe(true);
    expect(/ON agent_tasks \(created_by\)/i.test(allSql)).toBe(true);
    expect(/ON agent_tasks \(workflow_id\)/i.test(allSql)).toBe(true);
  });
  it('documents: owner_user_id; document children: document_id', () => {
    expect(/ON documents \(owner_user_id\)/i.test(allSql)).toBe(true);
    expect(/ON document_versions \(document_id\)/i.test(allSql)).toBe(true);
  });
  it('провайдеры: provider_type / enabled / provider_id / model_id', () => {
    expect(/ON llm_provider_registry \(provider_type\)/i.test(allSql)).toBe(true);
    expect(/ON llm_provider_registry \(enabled\)/i.test(allSql)).toBe(true);
    expect(/ON llm_provider_models \(provider_id\)/i.test(allSql)).toBe(true);
    expect(/ON llm_provider_models \(model_id\)/i.test(allSql)).toBe(true);
  });
});

describe('app SQL: идемпотентность', () => {
  it('outbox_events: UNIQUE(dedupe_key)', () => {
    expect(/UNIQUE \(dedupe_key\)/i.test(allSql)).toBe(true);
  });
  it('tool_call_logs: partial unique по idempotency_key', () => {
    expect(/UNIQUE INDEX[\s\S]*tool_call_logs \(idempotency_key\) WHERE idempotency_key IS NOT NULL/i.test(allSql)).toBe(true);
  });
  it('rag_queries: acl_scope и permission_decision NOT NULL', () => {
    const block = tableBlock('rag_queries');
    expect(/acl_scope\s+jsonb NOT NULL/i.test(block)).toBe(true);
    expect(/permission_decision\s+text NOT NULL/i.test(block)).toBe(true);
  });
});

describe('rag SQL: изолированная схема + pgvector + FTS', () => {
  it('CREATE SCHEMA rag и канонические таблицы', () => {
    expect(/CREATE SCHEMA rag/i.test(allSql)).toBe(true);
    expect(/CREATE TABLE rag\.corpus_chunks/i.test(allSql)).toBe(true);
    expect(/CREATE TABLE rag\.corpus_embeddings_768/i.test(allSql)).toBe(true);
    expect(/CREATE TABLE rag\.corpus_embeddings_1536/i.test(allSql)).toBe(true);
    expect(/CREATE TABLE rag\.index_runs/i.test(allSql)).toBe(true);
    expect(/CREATE TABLE rag\.eval_feedback/i.test(allSql)).toBe(true);
  });

  it('две размерности эмбеддингов: vector(768) и vector(1536) + CHECK', () => {
    expect(/vector\(768\)/i.test(allSql)).toBe(true);
    expect(/vector\(1536\)/i.test(allSql)).toBe(true);
    expect(/embedding_dim integer NOT NULL DEFAULT 768 CHECK \(embedding_dim = 768\)/i.test(allSql)).toBe(true);
    expect(/embedding_dim integer NOT NULL DEFAULT 1536 CHECK \(embedding_dim = 1536\)/i.test(allSql)).toBe(true);
  });

  it('generated tsvector на русском (FTS)', () => {
    expect(/GENERATED ALWAYS AS[\s\S]*?to_tsvector\('russian'/i.test(allSql)).toBe(true);
    expect(/USING gin \(search_vector\)/i.test(allSql)).toBe(true);
  });

  it('идемпотентность чанков: UNIQUE tuple', () => {
    expect(/UNIQUE \(document_version_id, source_text_hash, chunker_version, chunk_index\)/i.test(allSql)).toBe(true);
  });

  it('FK из rag ведут только в public.*/rag.* (нет PayHub-связок)', () => {
    const ragSql = sqlFiles['0005_rag.sql'] ?? '';
    expect(ragSql.length).toBeGreaterThan(0);
    expect(/REFERENCES public\.documents/i.test(ragSql)).toBe(true);
    const refs = ragSql.match(/REFERENCES\s+[A-Za-z_.]+/gi) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(/REFERENCES\s+(public\.|rag\.)/i.test(r)).toBe(true);
    }
  });
});

describe('rag SQL: HNSW только в *.no-tx.sql', () => {
  it('CONCURRENTLY встречается только в файлах *.no-tx.sql', () => {
    for (const [name, content] of Object.entries(sqlFiles)) {
      if (/CONCURRENTLY/i.test(content)) {
        expect(name.endsWith('.no-tx.sql')).toBe(true);
      }
    }
  });

  it('два HNSW-индекса в no-tx файле', () => {
    const noTx = sqlFiles['0006_rag_hnsw.no-tx.sql'] ?? '';
    const matches = noTx.match(/USING hnsw/gi) ?? [];
    expect(matches.length).toBe(2);
  });
});
