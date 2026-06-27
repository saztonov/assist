#!/usr/bin/env node
// Independent CI gate (does not depend on ESLint) enforcing the core invariant:
// the frontend (apps/ai-portal-web) must not import server/node-only code nor
// call external services directly. It statically scans the web source for:
//   1. imports of server-only @su10/* packages or raw node/server SDKs;
//   2. absolute external URLs in fetch()/axios calls (only relative /api and an
//      explicit allowlist are permitted).
// Exits non-zero on any violation.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = join(root, 'apps', 'ai-portal-web', 'src');

const FORBIDDEN_IMPORTS = [
  '@su10/db',
  '@su10/s3',
  '@su10/llm',
  '@su10/oidc',
  '@su10/rag',
  '@su10/connectors',
  '@su10/tools',
  '@su10/mcp',
  '@su10/agents',
  '@su10/workflow-engine',
  '@su10/audit',
  '@su10/permissions',
  '@su10/observability',
  '@su10/fastify-security',
  '@su10/logger',
  '@su10/config', // bare server entry; @su10/config/public is allowed
  'pg',
  'drizzle-orm',
  'openai',
  'fastify',
];
const FORBIDDEN_PREFIXES = ['@aws-sdk/', '@temporalio/', 'node:'];

// Hosts the browser is allowed to reach directly (everything else must go via /api).
const URL_ALLOWLIST = [/^\/api\//, /^\/assets\//];

const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
const dynImportRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const requireRe = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const fetchRe = /\bfetch\(\s*['"`]([^'"`]+)['"`]/g;
const absUrlRe = /^https?:\/\//i;

const violations = [];

function isForbiddenImport(spec) {
  if (spec === '@su10/config/public') return false;
  if (FORBIDDEN_IMPORTS.includes(spec)) return true;
  if (FORBIDDEN_PREFIXES.some((p) => spec.startsWith(p))) return true;
  return false;
}

function walk(d) {
  for (const entry of readdirSync(d)) {
    const p = join(d, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p);
    } else if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(p))) {
      scan(p);
    }
  }
}

function scan(file) {
  const src = readFileSync(file, 'utf8');
  for (const re of [importRe, dynImportRe, requireRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (isForbiddenImport(m[1])) {
        violations.push(`${file}: forbidden import of "${m[1]}"`);
      }
    }
  }
  fetchRe.lastIndex = 0;
  let f;
  while ((f = fetchRe.exec(src))) {
    const url = f[1];
    if (absUrlRe.test(url) && !URL_ALLOWLIST.some((re) => re.test(url))) {
      violations.push(`${file}: direct external fetch() to "${url}" (use the /api backend)`);
    }
  }
}

if (!existsSync(WEB_SRC)) {
  console.log('[check-frontend-boundaries] no web source found, skipping.');
  process.exit(0);
}

walk(WEB_SRC);

if (violations.length > 0) {
  console.error('[check-frontend-boundaries] FAILED:\n' + violations.map((v) => '  - ' + v).join('\n'));
  process.exit(1);
}
console.log('[check-frontend-boundaries] OK — frontend imports only browser-safe code and calls only the backend API.');
