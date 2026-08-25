import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min';

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

const names = new Intl.DisplayNames(['en'], { type: 'region' });

export const mobileRates = getCountries().map((countryCode: CountryCode) => ({
  id: countryCode.toLowerCase(),
  country_code: countryCode,
  country_name: names.of(countryCode) || countryCode,
  dial_code: `+${getCountryCallingCode(countryCode)}`,
  flag: countryCode,
  // Older TestFlight builds format this field as a number without a null check.
  rate_per_min: estimatedRates[countryCode] ?? 0,
})).sort((a, b) => a.country_name.localeCompare(b.country_name));
