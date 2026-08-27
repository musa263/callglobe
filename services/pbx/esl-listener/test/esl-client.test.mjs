import assert from 'node:assert/strict';
import test from 'node:test';
import { EslFrameParser } from '../src/esl-client.mjs';

test('ESL parser handles fragmented frames and byte content length', () => {
  const parser = new EslFrameParser();
  const body = JSON.stringify({ 'Event-Name': 'CHANNEL_CREATE', note: 'Riyadh call' });
  const frame = Buffer.from(`Content-Type: text/event-json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  assert.deepEqual(parser.push(frame.subarray(0, 17)), []);
  assert.deepEqual(parser.push(frame.subarray(17, 49)), []);
  const frames = parser.push(frame.subarray(49));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].headers['content-type'], 'text/event-json');
  assert.deepEqual(JSON.parse(frames[0].body), { 'Event-Name': 'CHANNEL_CREATE', note: 'Riyadh call' });
});

test('ESL parser reads adjacent header-only frames', () => {
  const parser = new EslFrameParser();
  const frames = parser.push(Buffer.from('Content-Type: auth/request\n\nContent-Type: command/reply\nReply-Text: +OK accepted\n\n'));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].headers['content-type'], 'auth/request');
  assert.equal(frames[1].headers['reply-text'], '+OK accepted');
});

test('ESL parser rejects excessive content lengths', () => {
  const parser = new EslFrameParser();
  assert.throws(() => parser.push(Buffer.from('Content-Type: text/event-json\nContent-Length: 9000000\n\n')), /invalid ESL Content-Length/);
});
