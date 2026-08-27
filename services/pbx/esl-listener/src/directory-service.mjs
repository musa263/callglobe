import { postSignedJson } from './signed-http.mjs';

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function notFoundXml() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>';
}

function userXml(user) {
  return `<user id="${xml(user.username)}"><params><param name="password" value="${xml(user.password)}"/><param name="vm-password" value="${xml(user.voicemailPassword || user.extension)}"/></params><variables><variable name="user_context" value="vocivo-internal"/><variable name="effective_caller_id_name" value="${xml(user.name)}"/><variable name="effective_caller_id_number" value="${xml(user.extension)}"/><variable name="outbound_caller_id_name" value="${xml(user.name)}"/><variable name="outbound_caller_id_number" value="${xml(user.outboundCallerId || '')}"/><variable name="vocivo_extension_id" value="${xml(user.id)}"/><variable name="vocivo_organization_id" value="${xml(user.organizationId)}"/><variable name="vocivo_organization_name" value="${xml(user.organizationName || '')}"/><variable name="vocivo_caller_photo" value="${xml(user.photoUrl || '')}"/><variable name="vocivo_sip_domain" value="${xml(user.domain)}"/></variables></user>`;
}

export function renderDirectoryXml(users) {
  if (!users.length) return notFoundXml();
  const domains = new Map();
  for (const user of users) {
    if (!domains.has(user.domain)) domains.set(user.domain, []);
    domains.get(user.domain).push(user);
  }
  const domainXml = [...domains.entries()].map(([domain, members]) => `<domain name="${xml(domain)}"><params><param name="dial-string" value="{presence_id=\${dialed_user}@\${dialed_domain},domain_name=\${dialed_domain}}\${sofia_contact(\${dialed_user}@\${dialed_domain})}"/></params><groups><group name="default"><users>${members.map(userXml).join('')}</users></group></groups></domain>`).join('');
  // FreeSWITCH drops the complete line containing an XML declaration while
  // preprocessing xml_curl responses, so the document must start on a new line.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<document type="freeswitch/xml"><section name="directory">${domainXml}</section></document>`;
}

function queryValue(params, names) {
  for (const name of names) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return '';
}

export class DirectoryService {
  #config;
  #log;
  #snapshot = null;
  #refreshPromise = null;
  #timer = null;

  constructor(config, log) {
    this.#config = config;
    this.#log = log;
  }

  get ready() {
    return !this.#config.snapshotUrl || Boolean(this.#snapshot);
  }

  get revision() {
    return this.#snapshot?.revision || null;
  }

  async start() {
    if (!this.#config.snapshotUrl) return;
    await this.refresh().catch((error) => this.#log('error', 'Initial PBX directory sync failed.', { error: error.message }));
    this.#timer = setInterval(() => {
      this.refresh().catch((error) => this.#log('warn', 'PBX directory refresh failed; using the last valid snapshot.', { error: error.message }));
    }, this.#config.refreshMs);
    this.#timer.unref();
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async refresh() {
    if (!this.#config.snapshotUrl) return null;
    this.#refreshPromise ||= (async () => {
      const snapshot = await postSignedJson(this.#config.snapshotUrl, { schema: 'vocivo.directory-query.v1' }, this.#config.webhookSecret, { timeoutMs: 10_000 });
      if (snapshot?.schema !== 'vocivo.directory.v1' || !Array.isArray(snapshot.users)) throw new Error('Directory service returned an invalid snapshot.');
      const valid = snapshot.users.every((user) => user && user.id && user.extension && user.username && user.password && user.domain && user.organizationId);
      if (!valid) throw new Error('Directory snapshot contains an invalid extension.');
      this.#snapshot = { ...snapshot, receivedAt: new Date().toISOString() };
      this.#log('info', 'PBX directory refreshed.', { revision: snapshot.revision, users: snapshot.users.length });
      return this.#snapshot;
    })().finally(() => { this.#refreshPromise = null; });
    return this.#refreshPromise;
  }

  async xmlFor(body) {
    if (!this.#snapshot && this.#config.snapshotUrl) await this.refresh();
    const params = new URLSearchParams(body);
    const keyValue = queryValue(params, ['key_value']);
    const username = queryValue(params, ['user', 'sip_auth_username']) || (keyValue && !keyValue.includes('.') ? keyValue : '');
    const domain = queryValue(params, ['domain', 'sip_auth_realm']) || (keyValue.includes('.') ? keyValue : '');
    let users = this.#snapshot?.users || [];
    if (domain) users = users.filter((user) => user.domain.toLowerCase() === domain.toLowerCase());
    if (username) users = users.filter((user) => user.username === username || user.extension === username);
    return renderDirectoryXml(users);
  }
}
