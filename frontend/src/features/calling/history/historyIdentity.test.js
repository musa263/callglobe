import test from 'node:test';
import assert from 'node:assert/strict';
import { describeHistory, historyEntry } from './historyIdentity.js';
import { describeIncoming, describeRemote } from '../engine/callIdentity.js';
import { formatPhone } from '../formatting.js';

const username = 'gencredx7a6b1c6';
const directory = [{ extension: '2000', name: 'Mousa', sipUsername: username }];
test('SIP credential digits never become the fabricated extension 7616', () => {
  assert.equal(formatPhone(username), 'Unknown caller');
  assert.equal(formatPhone('2003'), '2003');
  for (const number of [username, `sip:${username}@example.test`, `"Mousa" <sips:${username}@example.test>`]) {
    const peer = describeHistory({ number }, directory);
    assert.equal(peer.number, '2000'); assert.equal(peer.label, 'Mousa'); assert.equal(peer.canRedial, true);
    assert.equal(describeHistory({ number }, []).canRedial, false);
  }
});
test('foreign, duplicate and already damaged identifiers do not guess a colleague', () => {
  assert.equal(describeHistory({ number: username }, [{ extension: '2000', name: 'Other', sipUsername: 'other' }]).number, '');
  assert.equal(describeHistory({ number: username }, [...directory, { ...directory[0], extension: '2001' }]).canRedial, false);
  assert.equal(describeHistory({ number: '7616' }, directory).label, 'Company colleague');
  assert.equal(describeHistory({ number: '7616' }, directory).canRedial, false);
});
test('SIP and managed identities retain names, exact extensions and answered state in history', () => {
  const headers = { 'X-Vocivo-Caller-Name': 'Mousa', 'X-Vocivo-Caller-Extension': '2000' };
  const sip = describeIncoming({ remoteIdentity: { uri: `sip:${username}@example.test` }, request: { getHeader: name => headers[name] } });
  const managed = describeRemote({ options: { remoteCallerNumber: username, customHeaders: Object.entries(headers).map(([name,value]) => ({name,value})) } });
  for (const identity of [sip, managed]) {
    const entry = historyEntry({ ...identity, id: 'one', direction: 'incoming', duration: 0, answered: true });
    assert.equal(entry.name, 'Mousa'); assert.equal(entry.number, 'Extension 2000'); assert.equal(entry.answered, true);
    assert.equal(describeHistory(entry, directory).number, '2000');
  }
  const external = describeIncoming({ remoteIdentity: { uri: 'sips:+442079460018@example.test', displayName: 'Alex' } });
  assert.equal(external.internal, false); assert.equal(external.number, '+442079460018');
  assert.equal(describeHistory(external).label, 'Alex');
});
