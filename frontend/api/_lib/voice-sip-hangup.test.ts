import assert from 'node:assert/strict';
import test from 'node:test';

// The route table must answer the edge's hangup hook: it posted to
// /api/voice/sip-hangup for every outbound call and got 404 for months.
test('the voice route table has a handler for the edge hangup hook', async () => {
  const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('../voice.ts', import.meta.url), 'utf8'));
  assert.match(source, /'sip-hangup': sipHangup/);
});

test('dispatchers never resolve inherited object members', async () => {
  const fs = await import('node:fs');
  for (const file of ['../voice.ts', '../auth/[action].ts', '../admin/[resource].ts']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /hasOwnProperty\.call\(routes/, `${file} guards the lookup`);
  }
});
