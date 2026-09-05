import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min';
import type { CallRate } from '../../../shared/types';

const estimatedRates: Record<string, number> = {
  US: 0.02,
  GB: 0.025,
  SA: 0.04,
  AE: 0.03,
  PK: 0.04,
  IN: 0.015,
  PH: 0.035,
  NG: 0.06,
  EG: 0.045,
  BD: 0.04,
};

const displayNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export const fallbackRates: CallRate[] = getCountries().map((countryCode: CountryCode) => ({
  id: countryCode.toLowerCase(),
  country_code: countryCode,
  country_name: displayNames?.of(countryCode) || countryCode,
  dial_code: `+${getCountryCallingCode(countryCode)}`,
  flag: countryCode,
  rate_per_min: estimatedRates[countryCode] ?? 0,
})).sort((a, b) => a.country_name.localeCompare(b.country_name));

export const flagFromCode = (code: string) => {
  const normalized = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '🌐';
  return normalized.replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
};
