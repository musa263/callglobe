import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveSend, completeSend, sendOperationKey } from './send-operation.js';
import type { transactObject } from '../../shared/object-store.js';

test('concurrent/retried sends claim once and replay the accepted result', async () => {
  let stored: Buffer | null = null;
  let tail = Promise.resolve();
  const transaction = ((_: string, update: (value:Buffer|null)=>Promise<Buffer>) => {
    const run = tail.then(async () => {stored = await update(stored); return {body:stored};});
    tail = run.then(()=>{},()=>{}); return run;
  }) as typeof transactObject;
  const key = sendOperationKey('tenant','actor','fixture-operation');
  const claims = await Promise.all([reserveSend(key,'body-a',transaction), reserveSend(key,'body-a',transaction)]);
  assert.equal(claims.filter(item=>item.created).length,1);
  assert.equal((await reserveSend(key,'body-a',transaction)).operation.result, undefined);
  await assert.rejects(reserveSend(key,'body-b',transaction),/does not match/);
  const result={id:'carrier-message',status:'queued',direction:'outbound',created_at:'2026-09-07T00:00:00Z'};
  await completeSend(key,'body-a',result,transaction);
  const retry = await reserveSend(key,'body-a',transaction);
  assert.equal(retry.created,false);
  assert.deepEqual(retry.operation.result,result);
});
