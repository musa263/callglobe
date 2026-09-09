import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { resolveDialedNumber } from './dialedNumber.js';

export type CallingColleague = { id: string; extension: string; name: string; sipUsername?: string; presence?: 'online' | 'busy' | 'offline' };

export function cleanCallInput(value: string) {
  if (/[a-z@]/i.test(value)) return '';
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) % 16))
    .replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '').slice(0, 22);
}

export function resolveCallDestination(value: string, options: {
  business: boolean; ownExtension?: string; directory: CallingColleague[]; countryCode?: string; dialCode?: string;
}) {
  const input = cleanCallInput(value);
  const short = options.business && /^\d{2,5}$/.test(input) && !input.startsWith('00');
  const matches = short ? options.directory.filter(user => user.extension === input) : [];
  const colleague = matches.length === 1 ? matches[0] : undefined;
  const number = !options.countryCode && !/^(\+|00)/.test(input) ? '' : resolveDialedNumber(input, options.countryCode, options.dialCode);
  const kind = short ? input === options.ownExtension ? 'self' : colleague ? 'internal' : 'unknown-extension'
    : parsePhoneNumberFromString(number)?.isValid() ? 'external' : 'incomplete';
  return { input, kind, colleague, number } as const;
}
