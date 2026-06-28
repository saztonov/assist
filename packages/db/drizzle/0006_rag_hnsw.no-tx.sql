-- 0006_rag_hnsw.no-tx.sql — HNSW-индексы для приближённого векторного поиска.
--
-- ВАЖНО: НЕ выполнять внутри транзакции. `CREATE INDEX CONCURRENTLY` нельзя
-- запускать в транзакционном батче. Этот файл — ОТДЕЛЬНЫЙ/ОТЛОЖЕННЫЙ шаг и НЕ
-- требуется для локальных unit-тестов: точный векторный поиск (оператор <=>)
-- работает и без HNSW. Применять вручную/отдельным non-tx деплой-шагом после 0005.
--
-- PREREQUISITE: расширение vector включено (admin step). Метрика — косинус
-- (vector_cosine_ops), согласована с оператором поиска <=>.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS rag.ix_rag_emb768_hnsw;
--   DROP INDEX CONCURRENTLY IF EXISTS rag.ix_rag_emb1536_hnsw;

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_rag_emb768_hnsw
  ON rag.corpus_embeddings_768 USING hnsw (embedding vector_cosine_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_rag_emb1536_hnsw
  ON rag.corpus_embeddings_1536 USING hnsw (embedding vector_cosine_ops);
