// Run with node --import tsx scripts/migrate-extension-authority.mjs --env-file PATH
// Dry-run by default. This does not change carrier resources or deployment settings.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { readExtensionDirectoryState, adoptExtensionDirectory } from '../api/_lib/features/organizations/extension-store.ts';
import { validateVocivoExtensions } from '../api/_lib/features/organizations/extension-directory.ts';
import { assertVocivoExtensionEngine } from '../api/_lib/features/organizations/vocivo-extensions.ts';
import { readPbxConfig } from '../api/_lib/features/organizations/pbx-config-store.ts';

try {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf('--env-file');
  if (envIndex < 0 || !args[envIndex + 1]) throw new Error('Migration: --env-file is required.');
  const env = parseEnv(readFileSync(args[envIndex + 1], 'utf8'));
  for (const key of ['AUTH_SECRET', 'DATABASE_URL', 'POSTGRES_URL', 'VOCIVO_VOICE_EDGE', 'VOCIVO_SIP_INBOUND']) {
    if (env[key] !== undefined) process.env[key] = env[key]; else delete process.env[key];
  }
  // This migration has no reason to contact Telnyx, including during error recovery.
  delete process.env.TELNYX_API_KEY;
  process.env.DATABASE_CONNECT_TIMEOUT_SECONDS = '15';
  const before = await readExtensionDirectoryState();
  const initializeEmpty = args.includes('--initialize-empty');
  if (!before && !initializeEmpty) throw new Error('Migration: directory missing; import existing accounts before adoption. Use --initialize-empty only for a new installation.');
  validateVocivoExtensions(before?.extensions || []);
  const config = await readPbxConfig({ fresh: true });
  const organizationIds = new Set(config.organizations.map((item) => item.id));
  if (before?.extensions.some((item) => !organizationIds.has(item.organizationId))) throw new Error('Migration: directory contains an unknown organization.');
  // A Vercel export replaces sensitive values with empty strings. An empty
  // exported flag is insufficient evidence of the deployed runtime's setting.
  const engineEvidenceComplete = Boolean(process.env.VOCIVO_VOICE_EDGE?.trim() && process.env.VOCIVO_SIP_INBOUND?.trim());
  const engineReady = engineEvidenceComplete
    ? process.env.VOCIVO_VOICE_EDGE?.trim() === 'sip' && process.env.VOCIVO_SIP_INBOUND?.trim() === '1'
    : null;
  if (!args.includes('--apply')) {
    console.log(JSON.stringify({ dryRun: true, currentAuthority: before?.authority || 'telnyx',
      extensionCount: before?.extensions.length || 0, revision: before?.revision || 0,
      identitiesValid: true, engineSettingsReady: engineReady,
      engineSettingsEvidence: engineEvidenceComplete ? 'provided-env-file' : 'incomplete-env-export', carrierChanges: false }));
  } else {
    assertVocivoExtensionEngine();
    const after = await adoptExtensionDirectory({ initializeEmpty, expectedRevision: before?.revision || 0 });
    const verified = await readExtensionDirectoryState();
    if (verified?.authority !== 'vocivo' || Number(verified.revision) < Number(after.revision)) throw new Error('Migration: stored authority did not verify.');
    console.log(JSON.stringify({ migrated: true, authority: verified.authority, extensionCount: verified.extensions.length,
      identitiesPreserved: true, carrierChanges: false, carrierCredentialsRetained: true }));
  }
} catch (error) {
  // Do not print database URLs, carrier payloads, credentials or employee details.
  console.error(error instanceof Error && /^(Migration:|Extension directory|Vocivo extension authority|Stored extension)/.test(error.message)
    ? error.message : 'Extension migration failed; check storage configuration and access. No secret details printed.');
  process.exitCode = 1;
}
