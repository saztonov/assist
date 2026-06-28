/**
 * Local-first dev helper: mint a Keycloak-shaped RS256 access token + its public
 * JWKS so protected routes can be exercised WITHOUT a live Keycloak.
 *
 *   pnpm --filter @su10/agent-api mint-dev-token [sub] [comma,roles]
 *
 * Each run prints a matched pair: set OIDC_DEV_JWKS in the agent-api env, start
 * the server, then call the API with the printed Bearer token. NEVER use in prod.
 */
import { generateDevKeypair, signDevToken } from '@su10/oidc';

const issuer = process.env.OIDC_ISSUER ?? 'https://auth.su10.ru/realms/portal';
const audience = process.env.OIDC_AUDIENCE ?? 'agent-api';
const clientId = process.env.OIDC_CLIENT_ID ?? audience;

const sub = process.argv[2] ?? 'dev-user';
const roles = (process.argv[3] ?? 'portal_user').split(',').filter(Boolean);

const kp = await generateDevKeypair();
const token = await signDevToken(kp, {
  sub,
  issuer,
  audience: 'account',
  azp: clientId,
  email: `${sub}@dev.local`,
  preferredUsername: sub,
  realmRoles: roles,
  clientRoles: { [clientId]: roles },
  groups: [],
  expiresIn: '1h',
});

process.stdout.write('# 1) Set this in the agent-api env (local only, NEVER prod):\n');
process.stdout.write(`OIDC_DEV_JWKS=${JSON.stringify(kp.publicJwks)}\n\n`);
process.stdout.write('# 2) Bearer token (sub=' + sub + ', expires 1h):\n');
process.stdout.write(token + '\n');
