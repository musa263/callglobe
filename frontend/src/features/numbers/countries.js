import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min';

const names = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export function buildDialingDirectory(knownRates = []) {
  const ratesByCountry = new Map(knownRates.map((rate) => [rate.country_code, rate]));
  return getCountries().map((countryCode) => {
    const known = ratesByCountry.get(countryCode);
    return {
      id: countryCode.toLowerCase(),
      country_code: countryCode,
      country_name: names?.of(countryCode) || countryCode,
      dial_code: `+${getCountryCallingCode(countryCode)}`,
      rate_per_min: known?.rate_per_min ?? null,
    };
  }).sort((left, right) => left.country_name.localeCompare(right.country_name));
}
