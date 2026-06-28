/**
 * Connector Registry: аккаунты коннекторов, permissions и МЕТАДАННЫЕ токенов.
 * Сами токены не хранятся — только `secret_ref` на secret store + метаданные
 * (тип, scope, срок). Business/API SaaS вызываются только через Tool Broker.
 */
import { pgTable, uuid, text, jsonb, boolean } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt, tsOptional } from './_columns.js';

export const connectorAccounts = pgTable('connector_accounts', {
  id: uuidPk(),
  providerId: uuid('provider_id'),
  connectorKey: text('connector_key').notNull(),
  displayName: text('display_name'),
  ownerUserId: text('owner_user_id'),
  secretRef: text('secret_ref'),
  status: text('status').notNull().default('inactive'),
  enabled: boolean('enabled').notNull().default(false),
  metadataJson: jsonb('metadata_json'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const connectorPermissions = pgTable('connector_permissions', {
  id: uuidPk(),
  connectorAccountId: uuid('connector_account_id').notNull(),
  principalType: text('principal_type').notNull(),
  principalId: text('principal_id').notNull(),
  permission: text('permission').notNull().default('use'),
  createdAt: createdAt(),
});

export const connectorTokensMetadata = pgTable('connector_tokens_metadata', {
  id: uuidPk(),
  connectorAccountId: uuid('connector_account_id').notNull(),
  tokenType: text('token_type').notNull(), // access | refresh
  // Ссылка на secret store. Значение токена в БД НЕ хранится.
  secretRef: text('secret_ref').notNull(),
  scopes: jsonb('scopes'),
  expiresAt: tsOptional('expires_at'),
  lastRotatedAt: tsOptional('last_rotated_at'),
  createdAt: createdAt(),
});
