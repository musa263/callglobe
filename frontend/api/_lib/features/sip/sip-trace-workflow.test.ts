import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('call trace keeps ACK and trusted-source failures without scanner noise or regex errors', () => {
  const workflow = readFileSync(new URL('../../../../../.github/workflows/ops-sip-edge.yml', import.meta.url), 'utf8');
  const trace = workflow.slice(workflow.indexOf('            call-trace)'), workflow.indexOf('            deploy)'));
  const selection = trace.match(/grep -E "(INVITE\|[^"]+)"/)![1];
  assert.match('ACK dialog route', new RegExp(selection));
  const filter = trace.match(/awk "([^"]+)"/);
  assert.ok(filter, 'use a portable filter, not unsupported grep lookahead');
  const result = spawnSync('awk', [filter[1]], { encoding: 'utf8', input: [
    'ACK dialog route',
    'reject unauthenticated E.164 INVITE from 192.0.2.1',
    'reject unauthenticated E.164 INVITE from 192.76.120.10',
    'reject untrusted internal INVITE from 127.0.0.1',
    'malformed packet',
  ].join('\n') + '\n' });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'ACK dialog route',
    'reject unauthenticated E.164 INVITE from 192.76.120.10',
    'reject untrusted internal INVITE from 127.0.0.1',
  ]);
});


test('empty filtered service logs do not abort the remaining call trace', () => {
  const workflow = readFileSync(new URL('../../../../../.github/workflows/ops-sip-edge.yml', import.meta.url), 'utf8');
  const trace = workflow.slice(workflow.indexOf('            call-trace)'), workflow.indexOf('            deploy)'));
  const pipeline = trace.split('\n').find(line => line.includes('docker logs --since'))!;
  assert.ok(pipeline);
  const command = pipeline.slice(pipeline.indexOf('docker logs'));
  const result = spawnSync('bash', ['-c', 'set -euo pipefail; docker() { echo "vocivo.call warming"; }; ' + command + '; echo NEXT_SERVICE'], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NEXT_SERVICE/);
});
