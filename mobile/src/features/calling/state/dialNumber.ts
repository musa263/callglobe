import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import type { CallRate } from '../../../shared/types';

export type CallingColleague = { id: string; extension: string; name: string; department?: string; photoUrl?: string; presence?: 'online' | 'busy' | 'offline' };

export function dialRegion(value?: string | null): CountryCode | undefined {
  const region = value?.toUpperCase();
  return region && isSupportedCountry(region) ? region as CountryCode : undefined;
}

export function defaultDialRegion(localeRegion?: string | null, profileNumber?: string | null) {
  return dialRegion(localeRegion) || (profileNumber ? parsePhoneNumberFromString(profileNumber)?.country : undefined);
}

export function cleanDialInput(value: string) {
  if (/[a-z@]/i.test(value)) return '';
  const normalized = value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) % 16));
  return normalized.replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '').slice(0, 20);
}

/** An explicit international prefix always wins; a region only interprets local numbers. */
export function resolveDialNumber(value: string, region?: CountryCode, rates: CallRate[] = []) {
  const input = cleanDialInput(value).replace(/^00/, '+');
  const phone = parsePhoneNumberFromString(input, region);
  const valid = Boolean(phone?.isValid());
  const country = phone?.country;
  const rate = country ? rates.find((item) => item.country_code === country) : undefined;
  return {
    valid,
    number: valid && phone ? String(phone.number) : '',
    country,
    formatted: phone?.formatInternational() || input,
    rate: rate || {
      id: 'international', country_code: country || '', country_name: 'International',
      dial_code: phone ? `+${phone.countryCallingCode}` : '', flag: null, rate_per_min: null,
    },
  };
}

/** Directory matches are presentation hints; the route API still authorizes the call. */
export function resolveCallDestination(value: string, options: {
  business: boolean; ownExtension?: string; directory: CallingColleague[];
  region?: CountryCode; rates?: CallRate[];
}) {
  const input = cleanDialInput(value);
  const destination = resolveDialNumber(input, options.region, options.rates);
  // Never reinterpret an explicit international prefix as a company extension.
  const short = options.business && /^\d{2,5}$/.test(input) && !input.startsWith('00');
  const matches = short ? options.directory.filter((user) => user.extension === input) : [];
  const colleague = matches.length === 1 ? matches[0] : undefined;
  const kind = short
    ? input === options.ownExtension ? 'self' : colleague ? 'internal' : 'unknown-extension'
    : destination.valid ? 'external' : 'incomplete';
  return { kind, colleague, destination, input } as const;
}
