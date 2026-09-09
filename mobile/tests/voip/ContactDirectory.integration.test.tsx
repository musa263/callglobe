jest.mock('expo-contacts', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockPermission(...args),
  getContactsAsync: (...args: unknown[]) => mockContacts(...args),
  Fields: { PhoneNumbers: 'phones', Image: 'image' },
}));
const mockPermission = jest.fn(); const mockContacts = jest.fn();
beforeEach(() => { jest.resetModules(); mockPermission.mockReset().mockResolvedValue({ status: 'granted' }); mockContacts.mockReset(); });
test('explicit international country wins and shared national suffixes cannot identify a contact', async () => {
  mockContacts.mockResolvedValue({ data: [
    { name: 'Alex', phoneNumbers: [{ number: '020 7946 0018' }] },
    { name: 'Other country', phoneNumbers: [{ number: '+1 202 555 0123' }] },
  ] });
  const { findPhoneContact } = require('../../src/features/contacts/contactDirectory');
  expect(await findPhoneContact('+442079460018', 'SA')).toEqual({ name: 'Alex', photoUrl: undefined });
  expect(await findPhoneContact('+442025550123', 'GB')).toBeNull();
  expect(await findPhoneContact('5550123')).toBeNull();
  expect(mockContacts).toHaveBeenCalledTimes(1);
});
test('permission denial never requests contacts and duplicate identities fail closed', async () => {
  mockPermission.mockResolvedValue({ status: 'denied' });
  let find = require('../../src/features/contacts/contactDirectory').findPhoneContact;
  expect(await find('+12025550123')).toBeNull(); expect(mockContacts).not.toHaveBeenCalled();
  jest.resetModules(); mockPermission.mockResolvedValue({ status: 'granted' });
  mockContacts.mockResolvedValue({ data: [{ name: 'One', phoneNumbers: [{ number: '+12025550123' }] }, { name: 'Two', phoneNumbers: [{ number: '+12025550123' }] }] });
  find = require('../../src/features/contacts/contactDirectory').findPhoneContact;
  expect(await find('+12025550123')).toBeNull();
});
