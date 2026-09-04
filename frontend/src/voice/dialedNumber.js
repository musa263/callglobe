import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * The number a person meant, as E.164.
 *
 * The dialler used to glue the selected country's code onto whatever was
 * typed. That was right for a local number and wrong for the two other things
 * people type: a number that already carries its country code without the
 * plus ("971 50 123 4567" with the Emirates selected became +971971…, which
 * the API refused as "not a complete international destination"), and a
 * number with a 00 prefix. Each form is tried in the order a person would
 * mean it, and a form is only taken when it is a valid number.
 */
export function resolveDialedNumber(typed, countryCode, dialCode = '') {
  const raw = String(typed || '').replace(/[\s().-]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('00')) return `+${raw.slice(2)}`;
  const region = /^[A-Z]{2}$/.test(String(countryCode || '')) ? countryCode : undefined;
  const code = String(dialCode || '').replace(/\D/g, '');
  // Typed with the country code already in front: only when it really is one,
  // and the whole thing is a valid number — a local number that happens to
  // start with the same digits (many begin with the area code) stays local.
  if (code && raw.startsWith(code) && raw.length > code.length + 5) {
    const international = parsePhoneNumberFromString(`+${raw}`);
    if (international?.isValid()) return international.number;
  }
  const national = region ? parsePhoneNumberFromString(raw, region) : undefined;
  if (national?.isValid()) return national.number;
  // Nothing parsed as valid. Keep the old behaviour so a number the library's
  // metadata does not know is still sent on for the carrier to judge.
  const digits = raw.replace(/\D/g, '');
  return code ? `+${code}${digits.replace(/^0+/, '')}` : `+${digits}`;
}
