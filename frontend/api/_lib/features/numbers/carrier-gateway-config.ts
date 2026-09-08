import { isIP } from 'node:net';
import { normalizeCarrierTrunk, type CarrierTrunk } from './carrier-trunk-store.js';
import { carrierGateway, type CarrierDeployment } from './carrier-runtime.js';

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** A deployment artifact, not an activation or connectivity claim. */
export function renderCarrierGateway(trunk: CarrierTrunk, password: string, actualPublicIp: string, inboundSources: string[]) {
  normalizeCarrierTrunk(trunk, trunk.organizationId);
  if (!Number.isSafeInteger(trunk.revision) || trunk.revision < 1 || trunk.publicIp !== actualPublicIp) throw new Error('Carrier public IP does not match this SIP edge.');
  if (trunk.authentication === 'unconfirmed' || !trunk.channelLimit || trunk.inboundEnabled == null || trunk.outboundEnabled == null) throw new Error('Confirm authentication, call directions and capacity before deployment.');
  if (trunk.authentication === 'registration' && (!trunk.username || !password)) throw new Error('Carrier registration credentials are missing.');
  if (/[\r\n\0]|\$\{/.test(password) || /\$\{/.test(trunk.username)) throw new Error('Unsupported expansion in carrier credentials.');
  if (inboundSources.some(ip => isIP(ip) !== 4) || trunk.inboundEnabled && !inboundSources.length) throw new Error('Exact carrier signaling source IPv4 addresses are required.');
  const gateway = carrierGateway(trunk);
  const params: Record<string, string> = {
    proxy: `${trunk.server}:${trunk.port}`, realm: trunk.server,
    register: String(trunk.authentication === 'registration'),
    'register-transport': trunk.transport.toLowerCase(),
    'caller-id-in-from': 'true', 'from-domain': trunk.server,
    'extension-in-contact': 'true', ping: '30', 'expire-seconds': '300', 'retry-seconds': '30',
  };
  if (trunk.authentication === 'registration') { params.username = trunk.username; params.password = password; }
  if (trunk.outboundProxy) params['outbound-proxy'] = `${trunk.outboundProxy}:${trunk.outboundProxyPort || 5060}`;
  const deployment: CarrierDeployment = { organizationId: trunk.organizationId, trunkId: trunk.id, revision: trunk.connectionRevision || trunk.revision, publicIp: actualPublicIp, gateway, inboundSources };
  return { gateway, deployment, xml: `<include>\n<gateway name="${gateway}">\n${Object.entries(params).map(([name, value]) => `  <param name="${name}" value="${escapeXml(value)}"/>`).join('\n')}\n</gateway>\n</include>\n` };
}
