// Run with node --import tsx scripts/migrate-owner-credential.mjs --env-file PATH
// Dry-run by default. --apply copies the existing hash, never changes a password.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { readStoredOwnerPasswordHash, initializeOwnerPasswordHash } from '../api/_lib/features/auth/owner-credential-store.ts';

const args = process.argv.slice(2);
const envIndex = args.indexOf('--env-file');
if (envIndex < 0 || !args[envIndex + 1]) throw new Error('--env-file is required');
const values = parseEnv(readFileSync(args[envIndex + 1], 'utf8'));
for (const name of ['AUTH_SECRET', 'DATABASE_URL', 'POSTGRES_URL', 'TELNYX_API_KEY', 'TELNYX_PHONE_NUMBER_ID']) {
  if (values[name] !== undefined) process.env[name] = values[name]; else delete process.env[name];
}
// Operator connections may cross regions; production keeps its short default.
process.env.DATABASE_CONNECT_TIMEOUT_SECONDS = '15';
const apply = args.includes('--apply');
const removeLegacy = args.includes('--remove-legacy-tag');
if (removeLegacy && !apply) throw new Error('--remove-legacy-tag requires --apply');
const databaseUrl = new URL(values.DATABASE_URL || values.POSTGRES_URL);
if (!databaseUrl.hostname.endsWith('.prisma.io')) throw new Error('Expected the current Prisma Postgres destination.');

async function number(method = 'GET', tags) {
  const response = await fetch(`https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(values.TELNYX_PHONE_NUMBER_ID)}`, {
    method,
    headers: { Authorization: `Bearer ${values.TELNYX_API_KEY}`, ...(tags ? { 'Content-Type': 'application/json' } : {}) },
    ...(tags ? { body: JSON.stringify({ tags }) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Carrier request failed with HTTP ${response.status}`);
  return (await response.json()).data;
}

try {
  const stored = await readStoredOwnerPasswordHash();
  const data = await number();
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const legacy = tags.filter(tag => typeof tag === 'string' && tag.startsWith('vopwd_'));
  if (!legacy.length && stored) {
    console.log(JSON.stringify({ migrated: true, legacyTagPresent: false, changed: false }));
  } else {
    if (legacy.length !== 1) throw new Error('Expected exactly one legacy owner credential.');
    const hash = Buffer.from(legacy[0].slice(6), 'base64url').toString('utf8');
    if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) throw new Error('Legacy credential is not a valid bcrypt hash.');
    if (stored && stored !== hash) throw new Error('Stored password differs; do not overwrite or remove the legacy credential automatically.');
    if (!apply) {
      console.log(JSON.stringify({ dryRun: true, destination: 'Prisma Postgres', existingStoreRecord: Boolean(stored), sourceHashValid: true, passwordWillRemainUnchanged: true, legacyTagWillRemainUntilExplicitCleanup: true }));
    } else {
      if (!stored) await initializeOwnerPasswordHash(hash);
      if (await readStoredOwnerPasswordHash() !== hash) throw new Error('Imported credential did not verify.');
      if (removeLegacy) {
        // Re-read immediately before the update and preserve every unrelated tag.
        const latest = await number();
        const latestTags = latest.tags || [];
        const current = latestTags.filter(tag => typeof tag === 'string' && tag.startsWith('vopwd_'));
        if (current.length !== 1 || current[0] !== legacy[0]) throw new Error('Legacy credential changed during migration; cleanup stopped.');
        await number('PATCH', latestTags.filter(tag => tag !== legacy[0]));
        if ((await number()).tags?.some(tag => typeof tag === 'string' && tag.startsWith('vopwd_'))) throw new Error('Legacy tag cleanup did not verify.');
      }
      console.log(JSON.stringify({ migrated: true, encryptedStoreVerified: true, passwordUnchanged: true, legacyTagRemoved: removeLegacy }));
    }
  }
} catch (error) {
  // Never print driver errors, URLs, hashes or carrier payloads.
  const safe = error instanceof Error && /^(Expected|Legacy|Stored|Imported|Carrier request|Missing|Owner|A valid)/.test(error.message);
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code) ? error.code : 'UNKNOWN';
  console.error(safe ? error.message : `Credential migration failed (${code}); no secret details printed.`);
  process.exitCode = 1;
}
