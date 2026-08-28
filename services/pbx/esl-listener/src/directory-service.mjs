import fs from 'node:fs';
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

function regexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contextFromInclude(value, name) {
  const match = String(value).match(new RegExp(`<context\\s+name=["']${regexLiteral(name)}["'][^>]*>[\\s\\S]*?<\\/context>`));
  if (!match) throw new Error(`Dialplan template does not contain the ${name} context.`);
  return match[0];
}

export function renderDialplanTemplate(value, variables) {
  const rendered = Object.entries(variables || {}).reduce(
    (current, [name, replacement]) => current.replaceAll(`@@${name}@@`, String(replacement)),
    String(value),
  );
  const unresolved = rendered.match(/@@[A-Z0-9_]+@@/g);
  if (unresolved?.length) throw new Error(`Dialplan template has unresolved placeholders: ${[...new Set(unresolved)].join(', ')}.`);
  return rendered;
}

function routeXml(route, index) {
  const bridge = route.targets.map((target) => `[vocivo_push_target_extension=${xml(target.extension)},vocivo_target_extension_id=${xml(target.extensionId)}]user/${xml(target.username)}&#64;${xml(target.domain)}`).join(',');
  const didExpression = route.did.startsWith('+') ? `\\+?${regexLiteral(route.did.slice(1))}` : regexLiteral(route.did);
  const routeActions = bridge
    ? `<action application="set" data="hangup_after_bridge=true"/><action application="set" data="continue_on_fail=NO_ANSWER,USER_NOT_REGISTERED,SUBSCRIBER_ABSENT"/><action application="set" data="call_timeout=35"/><action application="set" data="ringback=\${us-ring}"/><action application="export" data="nolocal:vocivo_call_type=inbound"/><action application="export" data="nolocal:vocivo_call_id=\${vocivo_call_id}"/><action application="export" data="nolocal:vocivo_organization_id=\${vocivo_organization_id}"/><action application="export" data="nolocal:vocivo_organization_name=\${vocivo_organization_name}"/><action application="export" data="nolocal:vocivo_inbound_did=\${destination_number}"/><action application="export" data="nolocal:vocivo_caller_extension=\${caller_id_number}"/><action application="export" data="nolocal:vocivo_caller_name=\${caller_id_name}"/><action application="bridge" data="{ignore_early_media=true,originate_timeout=35}${bridge}"/><action application="hangup" data="NO_ANSWER"/>`
    : '<action application="respond" data="503 Assigned route has no active destination"/>';
  return `<extension name="vocivo-inbound-${index}"><condition field="destination_number" expression="^${xml(didExpression)}$"><action application="set" data="vocivo_call_id=\${uuid}"/><action application="set" data="vocivo_organization_id=${xml(route.organizationId)}"/><action application="set" data="vocivo_organization_name=${xml(route.organizationName)}"/>${routeActions}</condition></extension>`;
}

export function renderDialplanXml(routes, internalContext = '', requestedContext = '') {
  const publicContext = `<context name="public">${routes.map(routeXml).join('')}<extension name="reject-unassigned-public-call"><condition field="destination_number" expression="^.*$"><action application="respond" data="404 Number not assigned"/></condition></extension></context>`;
  const contexts = requestedContext === 'public'
    ? publicContext
    : requestedContext === 'vocivo-internal'
      ? internalContext
      : `${publicContext}${internalContext}`;
  if (!contexts) return notFoundXml();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<document type="freeswitch/xml"><section name="dialplan">${contexts}</section></document>`;
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
      if (snapshot?.schema !== 'vocivo.directory.v1' || !Array.isArray(snapshot.users) || !Array.isArray(snapshot.inboundRoutes)) throw new Error('Directory service returned an invalid snapshot.');
      const valid = snapshot.users.every((user) => user && user.id && user.extension && user.username && user.password && user.domain && user.organizationId);
      if (!valid) throw new Error('Directory snapshot contains an invalid extension.');
      const validRoutes = snapshot.inboundRoutes.every((route) => route && /^\+[1-9]\d{6,14}$/.test(route.did) && route.organizationId && Array.isArray(route.targets)
        && route.targets.every((target) => target.extensionId && target.extension && target.username && target.domain));
      if (!validRoutes) throw new Error('Directory snapshot contains an invalid inbound route.');
      this.#snapshot = { ...snapshot, receivedAt: new Date().toISOString() };
      this.#log('info', 'PBX directory refreshed.', { revision: snapshot.revision, users: snapshot.users.length, inboundRoutes: snapshot.inboundRoutes.length });
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

  async dialplanXmlFor(body) {
    if (!this.#snapshot && this.#config.snapshotUrl) await this.refresh();
    if (!this.#snapshot) return notFoundXml();
    const params = new URLSearchParams(body);
    const requestedContext = queryValue(params, ['Caller-Context', 'Hunt-Context', 'context']);
    if (requestedContext && !['public', 'vocivo-internal'].includes(requestedContext)) return notFoundXml();
    const template = renderDialplanTemplate(fs.readFileSync(this.#config.dialplanPath, 'utf8'), this.#config.dialplanVariables);
    const internalContext = contextFromInclude(template, 'vocivo-internal');
    return renderDialplanXml(this.#snapshot.inboundRoutes, internalContext, requestedContext);
  }
}
