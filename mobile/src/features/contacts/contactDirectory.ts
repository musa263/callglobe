import * as Contacts from 'expo-contacts';

type ContactIdentity = { name: string; photoUrl?: string };
let directoryPromise: Promise<Array<{ digits: string; identity: ContactIdentity }>> | null = null;

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
    digits: digits(phone.number || ''),
    identity: {
      name: contact.name || phone.number || 'Phone call',
      photoUrl: contact.image?.uri,
    },
  }))).filter((entry) => entry.digits.length >= 7);
}

export async function findPhoneContact(number: string): Promise<ContactIdentity | null> {
  const target = digits(number);
  if (target.length < 7) return null;
  if (!directoryPromise) {
    const pending = loadDirectory();
    directoryPromise = pending;
    pending.then(() => {
      setTimeout(() => { directoryPromise = null; }, 60_000);
    }, () => {
      // Retry on the next lookup instead of caching the failure for a minute.
      if (directoryPromise === pending) directoryPromise = null;
    });
  }
  const entries = await directoryPromise;
  const exact = entries.find((entry) => entry.digits === target);
  if (exact) return exact.identity;
  const suffixLength = Math.min(10, target.length);
  const suffix = target.slice(-suffixLength);
  return entries.find((entry) => entry.digits.slice(-suffixLength) === suffix)?.identity || null;
}
