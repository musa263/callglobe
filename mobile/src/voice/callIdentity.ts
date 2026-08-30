import type { Call } from '@telnyx/react-voice-commons-sdk';

export function inviteHeader(call: Call, name: string) {
  return call.inviteCustomHeaders?.find((header) => (
    String(header?.name || (header as { header_name?: string }).header_name || '').toLowerCase() === name.toLowerCase()
  ))?.value?.trim();
}

export function visibleCallAddress(value: string) {
  return /^sip:/i.test(value) ? 'Internal call' : value;
}
