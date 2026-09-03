import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BusinessVoiceConfig } from './number-config.js';
import { officeHoursDecision, userAvailableBySchedule } from './office-hours.js';
import type { ExtensionUser } from './pbx.js';
import type { PbxConfig } from './pbx-config-store.js';
import { normalizeE164 } from './tenancy.js';
import { forwardingTargetForCause, userNoAnswerSeconds, userVoicemailEnabled } from './user-call-routing.js';

/**
 * Renders the FreeSWITCH dialplan for inbound DIDs on the self-hosted SIP edge.
 *
 * FreeSWITCH asks the Vocivo API for a dialplan through mod_xml_curl at every
 * routing step, so the decision tree below mirrors the Telnyx Call Control
 * flow in routes/voice-webhook.ts while the API stays the single control plane:
 * every stage is stateless, carried between steps as `vocivo_*` channel
 * variables, and FreeSWITCH is only the executor.
 */

export type XmlCurlRequest = {
  section: string;
  context: string;
  destinationNumber: string;
  callerNumber: string;
  callerName: string;
  uuid: string;
  networkAddr: string;
  switchAddr: string;
  vocivoCallerIdHeader: string;
  /** `X-Vocivo-Flow`, which Kamailio sets to `inbound` on a call the carrier delivered. */
  vocivoFlowHeader: string;
  stage: string;
  organizationId: string;
  did: string;
  arg: string;
  digit: string;
  disposition: string;
  depth: number;
  visited: string[];
  attempt: number;
  waitingAnnounced: boolean;
  callerFrom: string;
  callerDisplay: string;
};

type Field = Record<string, unknown>;

function field(body: Field, ...names: string[]) {
  for (const name of names) {
    const value = body[name];
    if (typeof value === 'string' && value.length) return value;
  }
  return '';
}

export function parseXmlCurlRequest(body: unknown): XmlCurlRequest {
  const source: Field = body && typeof body === 'object' ? body as Field : {};
  const depth = Number.parseInt(field(source, 'variable_vocivo_depth'), 10);
  const attempt = Number.parseInt(field(source, 'variable_vocivo_attempt'), 10);
  return {
    section: field(source, 'section').toLowerCase(),
    context: field(source, 'Caller-Context', 'Hunt-Context', 'context').toLowerCase(),
    destinationNumber: field(source, 'Caller-Destination-Number', 'Hunt-Destination-Number', 'destination_number'),
    callerNumber: field(source, 'Caller-Caller-ID-Number', 'Hunt-Caller-ID-Number'),
    callerName: field(source, 'Caller-Caller-ID-Name', 'Hunt-Caller-ID-Name'),
    uuid: field(source, 'Caller-Unique-ID', 'Hunt-Unique-ID', 'Unique-ID'),
    networkAddr: field(source, 'Caller-Network-Addr', 'Hunt-Network-Addr'),
    switchAddr: field(source, 'FreeSWITCH-IPv4'),
    vocivoCallerIdHeader: field(source, 'variable_sip_h_X-Vocivo-Caller-ID'),
    vocivoFlowHeader: field(source, 'variable_sip_h_X-Vocivo-Flow').toLowerCase(),
    stage: field(source, 'variable_vocivo_stage').toLowerCase(),
    organizationId: field(source, 'variable_vocivo_org'),
    did: field(source, 'variable_vocivo_did'),
    arg: field(source, 'variable_vocivo_arg'),
    digit: field(source, 'variable_vocivo_digit').replace(/\D/g, '').slice(0, 5),
    disposition: field(source, 'variable_originate_disposition').toUpperCase(),
    depth: Number.isFinite(depth) ? Math.max(0, depth) : 0,
    visited: field(source, 'variable_vocivo_visited').split(/[:,]/).map((item) => item.trim()).filter(Boolean).slice(-5),
    attempt: Number.isFinite(attempt) ? Math.max(0, attempt) : 0,
    waitingAnnounced: field(source, 'variable_vocivo_waiting') === '1',
    callerFrom: field(source, 'variable_vocivo_from'),
    callerDisplay: field(source, 'variable_vocivo_name'),
  };
}

/**
 * Calls hairpinned from our own Kamailio (outbound origination, conferences,
 * internal calls) never get an inbound plan.
 *
 * Every call reaches FreeSWITCH from Kamailio on loopback — the carrier's too,
 * because the edge only accepts a DID on public 5060 and forwards it inside —
 * so the address alone cannot tell them apart. Kamailio tags what it accepted
 * from the carrier with `X-Vocivo-Flow: inbound`, and that tag decides.
 */
export function isLocalOrigination(request: XmlCurlRequest) {
  if (request.vocivoFlowHeader === 'inbound') return false;
  if (request.vocivoFlowHeader || request.vocivoCallerIdHeader) return true;
  const addr = request.networkAddr;
  return Boolean(addr) && (addr === '127.0.0.1' || addr === '::1' || (Boolean(request.switchAddr) && addr === request.switchAddr));
}

export type SipDialplanInput = {
  request: XmlCurlRequest;
  organizationId: string;
  did: string;
  /** Organization-scoped config (pbxForOrganization). */
  pbx: PbxConfig;
  business: BusinessVoiceConfig;
  extensions: ExtensionUser[];
  apiUrl: string;
  secret: string;
  promptFormat: 'wav' | 'mp3';
  recordingsDir: string;
  trunkGateway: string;
  /**
   * host:port of Vocivo's own receptionist, which FreeSWITCH reaches over the
   * Event Socket. Loopback on the SIP edge, because the receptionist runs on
   * the same droplet and nothing outside it should be able to answer calls.
   */
  receptionist?: string;
  now: Date;
};

const e164 = /^\+[1-9]\d{6,14}$/;
const kamailioLoopback = '127.0.0.1:5060';
const defaultReceptionist = '127.0.0.1:8084';
const queueAttemptSeconds = 45;
const maxForwardingDepth = 2;
const voicemailMaxSeconds = 120;

export function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Values placed into `set` must never carry FreeSWITCH expansion syntax or delimiters. */
export function channelSafe(value: string, max = 120) {
  return value.replace(/[^A-Za-z0-9 +._@:/'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function signature(secret: string, ...parts: string[]) {
  return createHmac('sha256', `${secret}:sip-dialplan`).update(parts.join('\n')).digest('base64url');
}

function signaturesMatch(expected: string, supplied: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function promptSignature(secret: string, text: string, voice: string, format: string) {
  return signature(secret, 'prompt', format, voice, text);
}

export function promptUrl(input: Pick<SipDialplanInput, 'apiUrl' | 'secret' | 'promptFormat'>, text: string, voice: string) {
  const sig = promptSignature(input.secret, text, voice, input.promptFormat);
  // mod_http_cache names its cached copy after the last dot in the whole URL,
  // query string included, and then opens the file by that "extension". A
  // period in the prompt text or in a voice id such as Vocivo.Kokoro.AmAdam
  // gave it an extension no file module handles, and every prompt failed to
  // open. Percent-encoding the dots keeps the extension at the path's .wav.
  const query = new URLSearchParams({ text, voice, sig }).toString().replace(/\./g, '%2E');
  return `${input.apiUrl.replace(/\/+$/, '')}/api/voice/sip-prompt/${sig.slice(0, 24)}.${input.promptFormat}?${query}`;
}

export function verifyPromptSignature(secret: string, text: string, voice: string, format: string, supplied: string) {
  return signaturesMatch(promptSignature(secret, text, voice, format), supplied);
}

export function voicemailUploadSignature(secret: string, organizationId: string, uuid: string, callerNumber: string, callerName: string, expires: string) {
  return signature(secret, 'voicemail', organizationId, uuid, callerNumber, callerName, expires);
}

export function voicemailUploadUrl(input: Pick<SipDialplanInput, 'apiUrl' | 'secret' | 'now'>, organizationId: string, uuid: string, callerNumber: string, callerName: string) {
  const expires = String(Math.floor(input.now.getTime() / 1000) + 60 * 60);
  const sig = voicemailUploadSignature(input.secret, organizationId, uuid, callerNumber, callerName, expires);
  const query = new URLSearchParams({ org: organizationId, call: uuid, from: callerNumber, name: callerName, exp: expires, sig });
  return `${input.apiUrl.replace(/\/+$/, '')}/api/voice/sip-voicemail?${query.toString()}`;
}

export function verifyVoicemailUpload(secret: string, params: { org: string; call: string; from: string; name: string; exp: string; sig: string }, now = new Date()) {
  const expires = Number(params.exp);
  if (!Number.isFinite(expires) || expires * 1000 < now.getTime()) return false;
  return signaturesMatch(voicemailUploadSignature(secret, params.org, params.call, params.from, params.name, params.exp), params.sig);
}

export function xmlCurlNotFound() {
  return '<document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>';
}

/* ------------------------------------------------------------------ */
/* Action builders                                                      */
/* ------------------------------------------------------------------ */

type Action = string;

function action(application: string, data?: string): Action {
  return data === undefined
    ? `<action application="${application}"/>`
    : `<action application="${application}" data="${escapeXml(data)}"/>`;
}

function set(name: string, value: string): Action {
  return action('set', `${name}=${value}`);
}

function stageVars(next: string, vars: Record<string, string | number | undefined>) {
  const actions = [set('vocivo_stage', next)];
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    actions.push(set(`vocivo_${name}`, channelSafe(String(value), 160)));
  }
  return actions;
}

function transferToStage(next: string, vars: Record<string, string | number | undefined> = {}) {
  return [...stageVars(next, vars), action('transfer', '${vocivo_did} XML public')];
}

function playback(input: SipDialplanInput, text: string) {
  return action('playback', `http_cache://${promptUrl(input, text, input.business.voice)}`);
}

function dialplanDocument(stage: string, actions: Action[]) {
  return [
    '<document type="freeswitch/xml">',
    '  <section name="dialplan" description="Vocivo inbound">',
    '    <context name="public">',
    `      <extension name="vocivo-inbound-${escapeXml(stage)}">`,
    '        <condition field="destination_number" expression=".*">',
    ...actions.map((item) => `          ${item}`),
    '        </condition>',
    '      </extension>',
    '    </context>',
    '  </section>',
    '</document>',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Routing helpers                                                      */
/* ------------------------------------------------------------------ */

function activeExtensions(input: SipDialplanInput) {
  return input.extensions.filter((item) => item.organizationId === input.organizationId && item.status === 'active' && item.sipUsername);
}

function contact(extension: ExtensionUser) {
  return `sofia/external/${extension.sipUsername}@${kamailioLoopback}`;
}

function trunkLeg(input: SipDialplanInput, destination: string) {
  const callerId = e164.test(input.did) ? input.did : '';
  const variables = callerId
    ? `{origination_caller_id_number=${callerId},origination_caller_id_name=Vocivo,sip_cid_type=pid,nolocal:sip_h_P-Asserted-Identity=<sip:${callerId}@sip.telnyx.com>}`
    : '';
  return `${variables}sofia/gateway/${input.trunkGateway}/${destination}`;
}

function callerVars(input: SipDialplanInput) {
  const number = channelSafe(input.request.callerFrom || input.request.callerNumber, 32);
  const name = channelSafe(input.request.callerDisplay || input.request.callerName, 80);
  return { number, name };
}

function bridgeActions(input: SipDialplanInput, legs: string[], timeoutSeconds: number, options: { announceWaiting: boolean; ringback?: boolean }) {
  const actions: Action[] = [];
  if (options.announceWaiting && !input.request.waitingAnnounced) {
    actions.push(playback(input, input.business.waitingMessage), set('vocivo_waiting', '1'));
  }
  actions.push(
    set('hangup_after_bridge', 'true'),
    set('continue_on_fail', 'true'),
    set('ignore_early_media', 'true'),
    set('call_timeout', String(Math.min(900, Math.max(5, Math.round(timeoutSeconds))))),
    set('ringback', '$${us-ring}'),
    action('bridge', legs.join(':_:')),
  );
  return actions;
}

function unavailableActions(input: SipDialplanInput, voicemailEnabled: boolean) {
  const business = input.business;
  const useVoicemail = business.voicemailEnabled && voicemailEnabled;
  if (!useVoicemail) {
    return [
      playback(input, 'No one is available to take your call right now. Please try again later.'),
      action('hangup', 'NORMAL_CLEARING'),
    ];
  }
  const caller = callerVars(input);
  const recording = `${input.recordingsDir.replace(/\/+$/, '')}/\${uuid}.wav`;
  // The upload URL is signed over the call id, so it must be the concrete value
  // xml_curl posted (FreeSWITCH cannot expand ${uuid} inside a percent-encoded URL).
  const callId = channelSafe(input.request.uuid, 64) || 'unknown-call';
  return [
    playback(input, business.voicemailGreeting),
    set('record_sample_rate', '8000'),
    set('RECORD_STEREO', 'false'),
    set('playback_terminators', 'none'),
    action('playback', 'tone_stream://%(500,0,800)'),
    action('record', `${recording} ${voicemailMaxSeconds} 30 5`),
    action('http_put', `${voicemailUploadUrl(input, input.organizationId, callId, caller.number, caller.name)} ${recording}`),
    action('system', `rm -f ${recording}`),
    action('hangup', 'NORMAL_CLEARING'),
  ];
}

function ringExtensionActions(input: SipDialplanInput, extension: ExtensionUser, options: { announceWaiting: boolean; depth: number; visited: string[] }) {
  const pbx = input.pbx;
  const profile = pbx.userProfiles[extension.id];
  const voicemailEnabled = userVoicemailEnabled(profile, input.business.voicemailEnabled);
  if (!userAvailableBySchedule(profile, pbx.officeHours, input.now)) {
    return unavailableActions(input, voicemailEnabled);
  }
  const legs = [contact(extension)];
  const simultaneous = profile?.simultaneousRing?.trim() || '';
  const simultaneousExtension = activeExtensions(input).find((item) => item.extension === simultaneous && item.id !== extension.id);
  if (simultaneousExtension) {
    legs.push(contact(simultaneousExtension));
  } else if (simultaneous) {
    const simultaneousNumber = normalizeE164(simultaneous);
    if (e164.test(simultaneousNumber) && e164.test(input.did)) legs.push(trunkLeg(input, simultaneousNumber));
  }
  return [
    ...bridgeActions(input, legs, userNoAnswerSeconds(profile, input.business.voicemailDelaySeconds), { announceWaiting: options.announceWaiting }),
    ...transferToStage('after-ring', {
      arg: extension.id,
      depth: options.depth,
      // ':' survives channelSafe and cannot appear in an extension id (see validateCallHandling).
      visited: [...new Set([...options.visited, extension.id])].slice(-5).join(':'),
    }),
  ];
}

function mainLineActions(input: SipDialplanInput) {
  const targets = activeExtensions(input);
  const organization = input.pbx.organizations.find((item) => item.id === input.organizationId && item.status === 'active');
  if (!targets.length || !organization || organization.accountType !== 'business') {
    return unavailableActions(input, true);
  }
  return [
    ...bridgeActions(input, targets.map(contact), input.business.voicemailDelaySeconds, { announceWaiting: false }),
    ...transferToStage('unavailable', { arg: 'business' }),
  ];
}

function departmentDestination(input: SipDialplanInput, department: string) {
  const extensions = activeExtensions(input);
  const departmental = extensions.find((item) => item.department.toLowerCase() === department.toLowerCase());
  return departmental || extensions[0] || null;
}

type GroupKind = 'ring_group' | 'queue';

function groupFor(input: SipDialplanInput, kind: GroupKind, id: string) {
  const collection = kind === 'ring_group' ? input.pbx.callHandling.ringGroups : input.pbx.callHandling.queues;
  return collection.find((item) => item.id === id) || null;
}

function groupFallbackActions(input: SipDialplanInput, kind: GroupKind, id: string) {
  const group = groupFor(input, kind, id);
  if (group?.fallback === 'Main line') return mainLineActions(input);
  return unavailableActions(input, true);
}

function groupActions(input: SipDialplanInput, kind: GroupKind, id: string, attempt: number) {
  const group = groupFor(input, kind, id);
  const members = group ? activeExtensions(input).filter((item) => group.members.includes(item.id)) : [];
  if (!group || !members.length) return groupFallbackActions(input, kind, id);
  if (kind === 'ring_group') {
    const timeout = Math.min(120, Math.max(10, 'timeout' in group ? group.timeout || 25 : 25));
    return [
      ...bridgeActions(input, members.map(contact), timeout, { announceWaiting: false }),
      ...transferToStage('after-group', { arg: `${kind}:${id}` }),
    ];
  }
  const maxWait = Math.min(900, Math.max(15, 'maxWait' in group ? group.maxWait || 180 : 180));
  const attempts = Math.max(1, Math.ceil(maxWait / queueAttemptSeconds));
  const nextAttempt = attempt + 1;
  const actions: Action[] = [];
  if (attempt === 0) actions.push(playback(input, input.business.waitingMessage), set('vocivo_waiting', '1'));
  actions.push(...bridgeActions(input, members.map(contact), Math.min(queueAttemptSeconds, maxWait), { announceWaiting: false }));
  if (nextAttempt < attempts) {
    actions.push(playback(input, input.business.waitingMessage), ...transferToStage('queue', { arg: `${kind}:${id}`, attempt: nextAttempt }));
  } else {
    actions.push(...transferToStage('after-group', { arg: `${kind}:${id}` }));
  }
  return actions;
}

function menuPrompt(input: SipDialplanInput) {
  const business = input.business;
  const hasExtensions = activeExtensions(input).length > 0;
  const options = business.departments.map((department, index) => `For ${department}, press ${index + 1}.`).join(' ');
  const validDigits = `${business.departments.map((_, index) => String(index + 1)).join('')}${hasExtensions ? '9' : ''}`;
  return {
    prompt: `${business.greeting} ${options}${hasExtensions ? ' If you know your party extension, press 9.' : ''}`,
    invalid: `That selection was not recognized. Please press one of these options: ${validDigits.split('').join(', ')}.`,
    validDigits,
    hasExtensions,
  };
}

function gatherActions(input: SipDialplanInput, options: { prompt: string; invalid: string; minDigits: number; maxDigits: number; regex: string; timeoutMs: number; next: string; vars?: Record<string, string> }) {
  const promptFile = `http_cache://${promptUrl(input, options.prompt, input.business.voice)}`;
  const invalidFile = `http_cache://${promptUrl(input, options.invalid, input.business.voice)}`;
  return [
    set('vocivo_digit', ''),
    action('play_and_get_digits', `${options.minDigits} ${options.maxDigits} 2 ${options.timeoutMs} # ${promptFile} ${invalidFile} vocivo_digit ${options.regex} 3000`),
    ...transferToStage(options.next, options.vars || {}),
  ];
}

function configuredTargetActions(input: SipDialplanInput, target: string, depth: number, visited: string[]) {
  const [type, id] = target.includes(':') ? target.split(':', 2) : ['extension', target];
  if (type === 'ring_group' || type === 'queue') return groupActions(input, type, id, 0);
  const extension = type === 'extension' ? activeExtensions(input).find((item) => item.id === id) : undefined;
  if (extension) return ringExtensionActions(input, extension, { announceWaiting: false, depth, visited });
  return unavailableActions(input, true);
}

function configuredIvrActions(input: SipDialplanInput, ivrId: string) {
  const ivr = input.pbx.callHandling.ivrs.find((item) => item.id === ivrId);
  const entries = Object.entries(ivr?.options || {}).filter(([digit, target]) => /^\d$/.test(digit) && Boolean(target)).slice(0, 10);
  if (!ivr || !entries.length) return unavailableActions(input, true);
  const label = (target: string) => {
    const [type, id] = target.includes(':') ? target.split(':', 2) : ['extension', target];
    if (type === 'extension') return input.extensions.find((item) => item.id === id)?.name || 'an extension';
    const collection = type === 'ring_group' ? input.pbx.callHandling.ringGroups : type === 'queue' ? input.pbx.callHandling.queues : [];
    return collection.find((item) => item.id === id)?.name || 'a team';
  };
  const digits = entries.map(([digit]) => digit).join('');
  return gatherActions(input, {
    prompt: `${ivr.greeting} ${entries.map(([digit, target]) => `For ${label(target)}, press ${digit}.`).join(' ')}`,
    invalid: `That selection was not recognized. Please press one of these options: ${digits.split('').join(', ')}.`,
    minDigits: 1,
    maxDigits: 1,
    regex: `^[${digits}]$`,
    timeoutMs: 10000,
    next: 'cfg-ivr-select',
    vars: { arg: ivr.id },
  });
}

function fsCauseToVocivo(disposition: string) {
  switch (disposition) {
    case 'USER_BUSY': return 'user_busy';
    case 'NO_ANSWER':
    case 'NO_USER_RESPONSE':
    case 'ALLOTTED_TIMEOUT': return 'timeout';
    case 'CALL_REJECTED': return 'call_rejected';
    default: return disposition.toLowerCase() || 'unavailable';
  }
}

/* ------------------------------------------------------------------ */
/* Stages                                                               */
/* ------------------------------------------------------------------ */

function entryActions(input: SipDialplanInput) {
  const pbx = input.pbx;
  const assignment = pbx.numberAssignments[input.did];
  const caller = callerVars(input);
  const prelude = [
    action('answer'),
    // The carrier's media takes a moment to arrive after the answer; a prompt
    // that starts before it does loses its first word or two.
    action('sleep', '400'),
    set('vocivo_org', channelSafe(input.organizationId, 80)),
    set('vocivo_did', channelSafe(input.did, 24)),
    set('vocivo_from', caller.number),
    set('vocivo_name', caller.name),
    set('vocivo_depth', '0'),
    set('vocivo_visited', ''),
  ];
  const owned = assignment?.organizationId === input.organizationId;
  if (owned && assignment?.destinationType === 'extension' && assignment.destinationId) {
    return [...prelude, ...configuredTargetActions(input, `extension:${assignment.destinationId}`, 0, [])];
  }
  if (!officeHoursDecision(pbx.officeHours, input.now).open) {
    return [...prelude, ...unavailableActions(input, true)];
  }
  if (owned && (assignment?.destinationType === 'ring_group' || assignment?.destinationType === 'queue') && assignment.destinationId) {
    return [...prelude, ...groupActions(input, assignment.destinationType, assignment.destinationId, 0)];
  }
  if (owned && assignment?.destinationType === 'ivr' && assignment.destinationId) {
    return [...prelude, ...configuredIvrActions(input, assignment.destinationId)];
  }
  if (input.pbx.ai?.enabled) return [...prelude, ...receptionistActions(input)];
  if (!input.business.enabled) return [...prelude, ...mainLineActions(input)];
  return [...prelude, ...menuFallbackActions(input)];
}

/**
 * Hands the call to Vocivo's own receptionist.
 *
 * `socket ... async full` connects FreeSWITCH to the receptionist service over
 * the Event Socket; that service answers, listens, thinks and speaks using
 * Vocivo's own speech recognition and voice, and transfers back into this same
 * dialplan when the caller asks for a person.
 *
 * The actions after it run only when the receptionist could not be reached, so
 * an unreachable service degrades to the voice menu rather than to silence.
 */
function receptionistActions(input: SipDialplanInput): Action[] {
  const address = input.receptionist || defaultReceptionist;
  return [
    set('vocivo_did', channelSafe(input.did)),
    set('vocivo_org', channelSafe(input.organizationId)),
    action('socket', `${address} async full`),
    action('log', 'WARNING Vocivo receptionist did not answer; falling back to the voice menu'),
    ...menuFallbackActions(input),
  ];
}

function menuFallbackActions(input: SipDialplanInput): Action[] {
  const menu = menuPrompt(input);
  return gatherActions(input, {
    prompt: menu.prompt,
    invalid: menu.invalid,
    minDigits: 1,
    maxDigits: 1,
    regex: `^[${menu.validDigits}]$`,
    timeoutMs: 10000,
    next: 'ivr-select',
  });
}

function ivrSelectActions(input: SipDialplanInput) {
  const menu = menuPrompt(input);
  const digit = input.request.digit;
  if (digit === '9' && menu.hasExtensions) {
    return gatherActions(input, {
      prompt: 'Please enter the extension number now.',
      invalid: 'That extension was not recognized.',
      minDigits: 2,
      maxDigits: 5,
      regex: '^\\d{2,5}$',
      timeoutMs: 8000,
      next: 'ext-select',
    });
  }
  const index = /^[1-9]$/.test(digit) ? Number(digit) : 0;
  const department = index >= 1 ? input.business.departments[index - 1] : undefined;
  if (!department) return unavailableActions(input, true);
  const destination = departmentDestination(input, department);
  if (!destination) return unavailableActions(input, true);
  return ringExtensionActions(input, destination, { announceWaiting: true, depth: 0, visited: [] });
}

function extensionSelectActions(input: SipDialplanInput) {
  const extension = activeExtensions(input).find((item) => item.extension === input.request.digit);
  if (extension) return ringExtensionActions(input, extension, { announceWaiting: true, depth: 0, visited: [] });
  const fallback = departmentDestination(input, input.business.companyName);
  const notice = playback(input, 'That extension is not available. We will connect you to the main line.');
  if (!fallback) return [notice, ...unavailableActions(input, true)];
  return [notice, ...ringExtensionActions(input, fallback, { announceWaiting: true, depth: 0, visited: [] })];
}

function configuredIvrSelectActions(input: SipDialplanInput) {
  const ivr = input.pbx.callHandling.ivrs.find((item) => item.id === input.request.arg);
  const target = ivr?.options[input.request.digit.slice(0, 1)];
  if (!target) return unavailableActions(input, true);
  return configuredTargetActions(input, target, 0, []);
}

function afterRingActions(input: SipDialplanInput) {
  const request = input.request;
  const extension = input.extensions.find((item) => item.id === request.arg);
  const profile = extension ? input.pbx.userProfiles[extension.id] : undefined;
  const voicemailEnabled = userVoicemailEnabled(profile, input.business.voicemailEnabled);
  const target = forwardingTargetForCause(profile, fsCauseToVocivo(request.disposition));
  const voicemailTarget = !target || ['voicemail', 'main voicemail'].includes(target.toLowerCase());
  if (voicemailTarget || request.depth >= maxForwardingDepth) return unavailableActions(input, voicemailEnabled);
  const visited = [...new Set([...request.visited, ...(extension ? [extension.id] : [])])].slice(-5);
  const forwardExtension = activeExtensions(input).find((item) => item.extension === target.replace(/\D/g, '') && item.id !== extension?.id && !visited.includes(item.id));
  if (forwardExtension) return ringExtensionActions(input, forwardExtension, { announceWaiting: false, depth: request.depth + 1, visited });
  const destination = normalizeE164(target);
  if (e164.test(destination) && e164.test(input.did)) {
    return [
      ...bridgeActions(input, [trunkLeg(input, destination)], 45, { announceWaiting: false }),
      ...transferToStage('unavailable', { arg: voicemailEnabled ? 'user' : 'none' }),
    ];
  }
  return unavailableActions(input, voicemailEnabled);
}

function afterGroupActions(input: SipDialplanInput) {
  const [kind, id] = input.request.arg.split(':', 2);
  if ((kind === 'ring_group' || kind === 'queue') && id) return groupFallbackActions(input, kind, id);
  return unavailableActions(input, true);
}

function queueActions(input: SipDialplanInput) {
  const [kind, id] = input.request.arg.split(':', 2);
  if (kind !== 'queue' || !id) return unavailableActions(input, true);
  return groupActions(input, 'queue', id, input.request.attempt);
}

export function renderSipDialplan(input: SipDialplanInput) {
  const stage = input.request.stage || 'entry';
  switch (stage) {
    case 'entry': return dialplanDocument('entry', entryActions(input));
    case 'ivr-select': return dialplanDocument('ivr-select', ivrSelectActions(input));
    case 'ext-select': return dialplanDocument('ext-select', extensionSelectActions(input));
    case 'cfg-ivr-select': return dialplanDocument('cfg-ivr-select', configuredIvrSelectActions(input));
    case 'after-ring': return dialplanDocument('after-ring', afterRingActions(input));
    case 'after-group': return dialplanDocument('after-group', afterGroupActions(input));
    case 'queue': return dialplanDocument('queue', queueActions(input));
    case 'unavailable': return dialplanDocument('unavailable', unavailableActions(input, input.request.arg !== 'none'));
    default: return dialplanDocument('unavailable', unavailableActions(input, true));
  }
}
