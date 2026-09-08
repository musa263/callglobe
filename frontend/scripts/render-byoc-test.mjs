// Local Docker fixture generator; no database or carrier network access.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCarrierTrunk } from '../api/_lib/features/numbers/carrier-trunk-store.ts';
import { renderCarrierGateway } from '../api/_lib/features/numbers/carrier-gateway-config.ts';
import { renderSipOutbound, outboundUnavailable } from '../api/_lib/features/sip/sip-outbound-dialplan.ts';
import { createVoiceRouteToken } from '../api/_lib/features/calling/voice-route-token.ts';
import { parseXmlCurlRequest } from '../api/_lib/features/sip/sip-dialplan.ts';
import { defaultPbxConfig } from '../api/_lib/features/organizations/pbx-config-store.ts';

process.env.AUTH_SECRET = 'isolated-byoc-wire-fixture';
const dir = process.argv[2];
if (!dir) throw new Error('A fixture output directory is required');
mkdirSync(dir, { recursive: true });
const routes = [], gateways = [];
for (const index of [0, 1]) {
  const organizationId = index ? 'second' : 'primary';
  const trunk = { ...normalizeCarrierTrunk({ id: `12345678-1234-1234-1234-12345678901${index}`, name: `Fixture ${index}`, provider: 'Local fixture',
    server: '127.0.0.1', port: 15080 + index, transport: 'UDP', publicIp: '127.0.0.1', authentication: 'ip',
    inboundEnabled: true, outboundEnabled: true, channelLimit: 1, numbers: [{ inboundNumber: `013511000${index}`, callerId: `96613511000${index}`, destinationType: 'main' }] }, organizationId), revision: 1, updatedAt: new Date().toISOString() };
  const artifact = renderCarrierGateway(trunk, '', '127.0.0.1', ['127.0.0.1']);
  gateways.push(artifact.xml.replace(/<\/?include>/g, ''));
  const grant = { routeId: `local-carrier-route-000${index}`, organizationId, flow: 'outbound', destination: `+96613555000${index}`, callerId: trunk.numbers[0].callerId,
    carrierTrunkId: trunk.id, carrierRevision: trunk.revision, carrierGateway: artifact.gateway };
  const token = createVoiceRouteToken(grant, 3600);
  const request = parseXmlCurlRequest({ section: 'dialplan', 'Caller-Destination-Number': grant.destination, 'variable_sip_h_X-Vocivo-Flow': 'outbound',
    'variable_sip_h_X-Vocivo-Caller-ID': grant.callerId, 'variable_sip_h_X-Vocivo-Route-Token': token });
  const config = defaultPbxConfig();
  if (index) config.organizations.push({ ...config.organizations[0], id: organizationId });
  const xml = await renderSipOutbound(request, config, async () => ({ trunkId: trunk.id, revision: trunk.revision, gateway: artifact.gateway, channelLimit: 1 }));
  routes.push({ ...grant, token, xml });
}
writeFileSync(join(dir, 'routes.json'), JSON.stringify({ routes, unavailable: outboundUnavailable() }));
const modules = ['console', 'logfile', 'commands', 'dptools', 'dialplan_xml', 'xml_curl', 'sofia', 'event_socket', 'hash', 'opus'];
const params = entries => Object.entries(entries).map(([name, value]) => `<param name="${name}" value="${value}"/>`).join('');
const configuration = (name, body) => `<configuration name="${name}">${body}</configuration>`;
writeFileSync(join(dir, 'freeswitch.xml'), `<document type="freeswitch/xml"><section name="configuration">
${configuration('modules.conf', `<modules>${modules.map(name => `<load module="mod_${name}"/>`).join('')}</modules>`)}
${configuration('switch.conf', `<settings>${params({ 'max-sessions': 10, 'sessions-per-second': 10, 'rtp-start-port': 9900, 'rtp-end-port': 9939 })}</settings>`)}
${configuration('console.conf', '<mappings><map name="all" value="console,debug,info,notice,warning,err,crit,alert"/></mappings><settings><param name="colorize" value="false"/><param name="loglevel" value="debug"/></settings>')}
${configuration('event_socket.conf', `<settings>${params({ 'listen-ip': '127.0.0.1', 'listen-port': 18021, password: 'local-test-only', 'apply-inbound-acl': 'loopback.auto' })}</settings>`)}
${configuration('xml_curl.conf', '<bindings><binding name="fixture"><param name="gateway-url" value="http://127.0.0.1:18881/dialplan" bindings="dialplan"/><param name="disable-100-continue" value="true"/><param name="timeout" value="8"/></binding></bindings>')}
${configuration('sofia.conf', `<profiles><profile name="test-edge"><gateways>${gateways.join('')}</gateways><settings>${params({ 'sip-ip': '127.0.0.1', 'sip-port': 15060, 'rtp-ip': '127.0.0.1', context: 'public', dialplan: 'XML', 'auth-calls': 'false', 'disable-register': 'true', 'apply-inbound-acl': 'loopback.auto', 'inbound-codec-prefs': 'OPUS,PCMA,PCMU', 'outbound-codec-prefs': 'PCMA,PCMU', 'manage-presence': 'false' })}</settings></profile></profiles>`)}
</section><section name="dialplan"><context name="public"><extension name="refuse"><condition><action application="respond" data="503 Unavailable"/></condition></extension></context></section></document>`);
console.log('Prepared two isolated tenant gateways and signed XML dialplans.');
