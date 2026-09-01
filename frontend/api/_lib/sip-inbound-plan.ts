import { pbxForOrganization, type PbxConfig } from './pbx-config-store.js';
import { numberUsesSipInbound, sipInboundBlockedReason, voiceWalletCharge } from './inbound-billing.js';
import { officeHoursDecision } from './office-hours.js';
import { sipInboundEnabled } from './voice-provider.js';
import { normalizeE164 } from './tenancy.js';

export type SipInboundAction = 'bridge' | 'ivr' | 'queue' | 'ai' | 'closed' | 'none';

export type SipInboundPlan = {
  enabled: boolean;
  action: SipInboundAction;
  reason?: string;
  organizationId?: string;
  handlingId?: string;
  target?: string;
  prompt: string;
  digits: string;
  timeoutMs: number;
  timeoutSec: number;
  tries: number;
  wallet: { charged: boolean; reason: string };
};

const closedPrompt = 'Thank you for calling. Our office is closed. Please try again during business hours.';

export function sanitizePrompt(value: string) {
  return value.replace(/"/g, '').replace(/[\n\r]+/g, ' ').replace(/[^A-Za-z0-9 .,!?'+-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function ivrPrompt(greeting: string, entries: Array<[string, string]>, pbx: ReturnType<typeof pbxForOrganization>) {
  const options = entries.map(([digit, target]) => {
    const [type, id] = target.split(':', 2);
    const label = type === 'ring_group'
      ? pbx.callHandling.ringGroups.find((item) => item.id === id)?.name
      : type === 'queue'
        ? pbx.callHandling.queues.find((item) => item.id === id)?.name
        : 'an extension';
    return `For ${label || 'this option'}, press ${digit}.`;
  }).join(' ');
  return sanitizePrompt(`${greeting} ${options}`);
}

export function planSipInbound(to: string, config: PbxConfig): SipInboundPlan {
  const wallet = voiceWalletCharge('inbound');
  const empty: SipInboundPlan = { enabled: false, action: 'none', prompt: '', digits: '', timeoutMs: 10000, timeoutSec: 10, tries: 2, wallet };
  const did = normalizeE164(to);
  const assignment = config.numberAssignments[did];
  if (!assignment?.organizationId) return { ...empty, reason: 'unassigned' };
  const sipNumber = numberUsesSipInbound(assignment);
  if (!sipNumber && !sipInboundEnabled()) {
    return { ...empty, reason: sipInboundBlockedReason(assignment) || 'call_control', organizationId: assignment.organizationId };
  }
  const pbx = pbxForOrganization(config, assignment.organizationId);
  const hours = officeHoursDecision(pbx.officeHours);
  if (!hours.open) {
    return {
      enabled: true,
      action: 'closed',
      reason: 'closed',
      organizationId: assignment.organizationId,
      prompt: sanitizePrompt(closedPrompt),
      digits: '',
      timeoutMs: 10000,
      timeoutSec: 10,
      tries: 1,
      wallet,
    };
  }
  if (assignment.destinationType === 'ivr' && assignment.destinationId) {
    return ivrPlan(pbx, assignment.organizationId, assignment.destinationId, wallet);
  }
  if (assignment.destinationType === 'queue' && assignment.destinationId) {
    const queue = pbx.callHandling.queues.find((item) => item.id === assignment.destinationId);
    if (!queue) return { ...empty, reason: 'no_contacts', organizationId: assignment.organizationId };
    return {
      enabled: true,
      action: 'queue',
      organizationId: assignment.organizationId,
      handlingId: queue.id,
      prompt: sanitizePrompt(config.businessVoiceConfigs[assignment.organizationId]?.waitingMessage || 'Please wait. A colleague will be with you shortly.'),
      digits: '',
      timeoutMs: Math.min(900, Math.max(15, queue.maxWait || 180)) * 1000,
      timeoutSec: Math.min(900, Math.max(15, queue.maxWait || 180)),
      tries: 1,
      wallet,
    };
  }
  if (assignment.destinationType === 'ring_group' || assignment.destinationType === 'extension') {
    return {
      enabled: true,
      action: 'bridge',
      organizationId: assignment.organizationId,
      handlingId: assignment.destinationId,
      prompt: '',
      digits: '',
      timeoutMs: 25000,
      timeoutSec: 25,
      tries: 1,
      wallet,
    };
  }
  if (pbx.ai.enabled) {
    return {
      enabled: true,
      action: 'ai',
      organizationId: assignment.organizationId,
      handlingId: pbx.ai.fallbackExtension || '',
      prompt: sanitizePrompt(`${pbx.ai.greeting || 'Hello.'} Press 1 to reach the team. Press 0 for the operator.`),
      digits: '01',
      timeoutMs: 12000,
      timeoutSec: 12,
      tries: 2,
      wallet,
    };
  }
  const voice = config.businessVoiceConfigs[assignment.organizationId];
  if (voice?.enabled && voice.departments.length) {
    const entries = voice.departments.map((name, index) => [String(index + 1), `department:${name}`] as [string, string]);
    return {
      enabled: true,
      action: 'ivr',
      organizationId: assignment.organizationId,
      handlingId: 'business-voice',
      prompt: sanitizePrompt(`${voice.greeting} ${voice.departments.map((name, index) => `For ${name}, press ${index + 1}.`).join(' ')}`),
      digits: entries.map(([digit]) => digit).join(''),
      timeoutMs: 10000,
      timeoutSec: 10,
      tries: 2,
      wallet,
    };
  }
  return {
    enabled: true,
    action: 'bridge',
    organizationId: assignment.organizationId,
    prompt: '',
    digits: '',
    timeoutMs: 25000,
    timeoutSec: 25,
    tries: 1,
    wallet,
  };
}

function ivrPlan(pbx: ReturnType<typeof pbxForOrganization>, organizationId: string, handlingId: string, wallet: SipInboundPlan['wallet']): SipInboundPlan {
  const ivr = pbx.callHandling.ivrs.find((item) => item.id === handlingId);
  const entries = Object.entries(ivr?.options || {}).filter(([digit, target]) => /^\d$/.test(digit) && Boolean(target)).slice(0, 10) as Array<[string, string]>;
  if (!ivr || !entries.length) {
    return { enabled: false, action: 'none', reason: 'no_contacts', organizationId, prompt: '', digits: '', timeoutMs: 10000, timeoutSec: 10, tries: 2, wallet };
  }
  return {
    enabled: true,
    action: 'ivr',
    organizationId,
    handlingId: ivr.id,
    prompt: ivrPrompt(ivr.greeting, entries, pbx),
    digits: entries.map(([digit]) => digit).join(''),
    timeoutMs: 10000,
    timeoutSec: 10,
    tries: 2,
    wallet,
  };
}

export function planSipInboundDigit(to: string, digit: string, config: PbxConfig): SipInboundPlan {
  const base = planSipInbound(to, config);
  const pressed = String(digit || '').trim().slice(0, 1);
  if (!base.enabled || !base.organizationId) return base;
  const pbx = pbxForOrganization(config, base.organizationId);
  const assignment = config.numberAssignments[normalizeE164(to)];
  if (base.action === 'ai') {
    if (pressed === '0' || pressed === '1') {
      return { ...base, action: 'bridge', prompt: '', digits: '', handlingId: pbx.ai.fallbackExtension || assignment?.destinationId };
    }
    return base;
  }
  if (base.action === 'ivr' && assignment?.destinationType === 'ivr' && assignment.destinationId) {
    const ivr = pbx.callHandling.ivrs.find((item) => item.id === assignment.destinationId);
    const target = ivr?.options?.[pressed];
    if (!target) return { ...base, reason: 'invalid_digit' };
    return planFromTarget(target, base);
  }
  if (base.action === 'ivr' && base.handlingId === 'business-voice') {
    const voice = config.businessVoiceConfigs[base.organizationId];
    const index = Number(pressed) - 1;
    const department = voice?.departments[index];
    if (!department) return { ...base, reason: 'invalid_digit' };
    return { ...base, action: 'bridge', prompt: '', digits: '', target: `department:${department}` };
  }
  return base;
}

function planFromTarget(target: string, base: SipInboundPlan): SipInboundPlan {
  const [type, id] = target.split(':', 2);
  if (type === 'queue') return { ...base, action: 'queue', handlingId: id, prompt: sanitizePrompt('Please wait.'), digits: '' };
  if (type === 'ring_group' || type === 'extension') {
    return { ...base, action: 'bridge', handlingId: id, target, prompt: '', digits: '' };
  }
  return { ...base, action: 'bridge', target, prompt: '', digits: '' };
}
