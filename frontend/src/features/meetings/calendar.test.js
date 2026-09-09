import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarEvent, utcDateTime, localDateTime } from './calendar.js';
test('calendar uses UTC, escaped text, stable UID and no join bearer token', () => {
  const meeting = { id: 'scheduled-one', title: 'Review, together; now\nNext line', notes: 'Line 1\nLine 2', kind: 'video', roomId: 'room-one', version: 2, startsAt: '2027-01-01T06:00:00Z', durationMinutes: 30, token: 'never-export-me' };
  const value = calendarEvent(meeting, 'https://vocivo.app');
  assert.match(value, /DTSTART:20270101T060000Z/); assert.match(value, /UID:scheduled-one@vocivo/);
  assert.match(value, /TRIGGER:-PT10M/); assert.match(value, /SEQUENCE:2/);
  assert.ok(!value.includes('never-export-me')); assert.ok(value.includes('meeting=room-one'));
  const local = localDateTime('2027-01-01T06:00:00Z'); assert.equal(utcDateTime(local), '2027-01-01T06:00:00.000Z');
  assert.throws(() => utcDateTime('not-a-date'));
});
