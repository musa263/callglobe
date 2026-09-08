// Deployment preparation only. Does not activate a trunk or alter any carrier account.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
import { carrierTrunks } from '../api/_lib/features/numbers/carrier-trunk-store.ts';
import { renderCarrierGateway } from '../api/_lib/features/numbers/carrier-gateway-config.ts';
import { readPbxConfig } from '../api/_lib/features/organizations/pbx-config-store.ts';

try {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`Required: ${name}`); return args[i + 1]; };
  const env = parseEnv(readFileSync(option('--env-file'), 'utf8'));
  for (const key of ['AUTH_SECRET', 'DATABASE_URL', 'POSTGRES_URL']) if (env[key]) process.env[key] = env[key];
  delete process.env.TELNYX_API_KEY;
  const organizationId = option('--organization'), id = option('--trunk'), revision = Number(option('--revision'));
  const config = await readPbxConfig({ fresh: true });
  if (!config.organizations.some(item => item.id === organizationId && item.status === 'active')) throw new Error('Company inactive');
  const { trunk, password } = await carrierTrunks.provisioning(organizationId, id, revision);
  if (!trunk.numbers.length || trunk.numbers.some(number => {
    const assignment = config.numberAssignments[number.callerId];
    return assignment?.organizationId !== organizationId || assignment.disabled || assignment.carrierTrunkId !== id || assignment.carrierTrunkRevision !== revision;
  })) throw new Error('Publish the current carrier number inventory first');
  const artifact = renderCarrierGateway(trunk, password, option('--public-ip'), option('--inbound-sources').split(',').filter(Boolean));
  if (args.includes('--write')) {
    const dir = option('--output-dir');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${artifact.gateway}.xml`), artifact.xml, { mode: 0o600, flag: 'wx' });
    writeFileSync(join(dir, 'deployment-candidate.json'), JSON.stringify(artifact.deployment, null, 2), { mode: 0o600, flag: 'wx' });
  }
  console.log(JSON.stringify({ dryRun: !args.includes('--write'), gateway: artifact.gateway, revision, numberCount: trunk.numbers.length, activated: false }));
} catch {
  console.error('Carrier export failed. Check company, revision, published numbers, edge IP, credentials and output directory. No secrets printed.');
  process.exitCode = 1;
}
