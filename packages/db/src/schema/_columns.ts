/**
 * Общие билдеры колонок для app-схемы. Каждая функция возвращает НОВЫЙ билдер
 * (column builder в Drizzle мутабелен и привязан к таблице — переиспользовать
 * один и тот же экземпляр нельзя).
 *
 * Замечание по источникам истины: FK-ограничения и индексы задаются в SQL-миграциях
 * (`drizzle/*.sql`) — они канон. В Drizzle FK-колонки объявляются как обычные `uuid`
 * без `.references()`, чтобы модули схемы не зависели друг от друга по импортам
 * (исключает циклы и фиксирует порядок только на уровне SQL).
 */
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** uuid PK с server-side default `gen_random_uuid()`. */
export const uuidPk = () => uuid('id').defaultRandom().primaryKey();

/** `created_at timestamptz NOT NULL DEFAULT now()`. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** `updated_at timestamptz NOT NULL DEFAULT now()`. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Опциональный `timestamptz` (момент события/перехода). */
export const tsOptional = (name: string) => timestamp(name, { withTimezone: true });
