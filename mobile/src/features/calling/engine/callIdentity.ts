import type { VoiceCall } from './voiceEngine';

export function inviteHeader(call: VoiceCall, name: string) {
  return call.inviteCustomHeaders?.find((header) => (
    String(header?.name || (header as { header_name?: string }).header_name || '').toLowerCase() === name.toLowerCase()
  ))?.value?.trim();
}

export function visibleCallAddress(value: string) {
  const user = identityUser(value);
  return /^\+?[\d ().-]+$/.test(user) ? user : 'Internal call';
}

export function identityUser(value: string) {
  const raw = String(value || '').trim();
  return raw.match(/sips?:([^@;>\s]+)(?:@|;|>|$)/i)?.[1] || raw;
}

export function identityExtension(value: string) {
  return String(value || '').trim().match(/^(?:Extension\s+)?(\d{2,5})$/i)?.[1] || '';
}

export function visibleCallerName(value?: string | null) {
  const name = String(value || '').trim();
  return !name || /sips?:|@|gencred|[\x00-\x1f\x7f]/i.test(name)
    || /^[\da-f]{8}-(?:[\da-f-]{27,})$/i.test(name)
    || /^(unknown(?: caller)?|internal call|phone call|incoming call)$/i.test(name) ? '' : name;
}
