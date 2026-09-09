import * as Contacts from 'expo-contacts';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

type ContactIdentity = { name: string; photoUrl?: string };
let directoryPromise: Promise<Array<{ number: string; digits: string; identity: ContactIdentity }>> | null = null;
let expiresAt = 0;

function digits(value: string) {
  return value.replace(/\D/g, '');
}

async function loadDirectory() {
  const permission = await Contacts.getPermissionsAsync();
  if (permission.status !== 'granted') return [];
  const result = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Image],
  });
  return result.data.flatMap((contact) => (contact.phoneNumbers || []).map((phone) => ({
    number: phone.number || '',
    digits: digits(phone.number || ''),
    identity: {
      name: contact.name || phone.number || 'Phone call',
      photoUrl: contact.image?.uri,
    },
  }))).filter((entry) => entry.digits.length >= 7);
}

export async function findPhoneContact(number: string, region?: CountryCode): Promise<ContactIdentity | null> {
  const target = digits(number);
  if (target.length < 7) return null;
  if (!directoryPromise || Date.now() >= expiresAt) {
    const pending = loadDirectory();
    directoryPromise = pending;
    expiresAt = Date.now() + 60_000;
    pending.catch(() => {
      // Retry on the next lookup instead of caching the failure for a minute.
      if (directoryPromise === pending) directoryPromise = null;
    });
  }
  const entries = await directoryPromise;
  const parsed = parsePhoneNumberFromString(number, region);
  const canonical = parsed?.isValid() ? parsed.number : null;
  const matches = entries.filter(entry => {
    const candidate = parsePhoneNumberFromString(entry.number, parsed?.country || region);
    return canonical ? candidate?.isValid() && candidate.number === canonical : entry.digits === target;
  });
  // A shared suffix is not identity: two countries can have the same national digits.
  return matches.length && matches.every(entry => entry.identity.name === matches[0]!.identity.name)
    ? matches[0]!.identity : null;
}
