import { createHash } from 'node:crypto';
import { transactObject } from '../../shared/object-store.js';

type Result = { id: string; status: string; direction: string; created_at: string };
type Operation = { fingerprint: string; result?: Result };
const path = (key: string) => `vocivo/sms-operations/${key}.json`;
export const sendOperationKey = (organization: string, actor: string, id: string) => createHash('sha256').update(JSON.stringify([organization, actor, id])).digest('hex');
export const sendFingerprint = (from: string, to: string, text: string) => createHash('sha256').update(JSON.stringify([from,to,text])).digest('hex');

export async function reserveSend(key: string, fingerprint: string, transaction: typeof transactObject = transactObject) {
  let created = false;
  const result = await transaction(path(key), current => {
    created = !current;
    const operation: Operation = current ? JSON.parse(current.toString()) : {fingerprint};
    if (operation.fingerprint !== fingerprint) throw new Error('Message operation does not match the original message.');
    return Buffer.from(JSON.stringify(operation));
  }, {access:'private', contentType:'application/json'});
  return {created, operation: JSON.parse(result.body.toString()) as Operation};
}
export async function completeSend(key: string, fingerprint: string, result: Result, transaction: typeof transactObject = transactObject) {
  if (!/^[a-f0-9]{64}$/.test(key)) return;
  await transaction(path(key), current => {
    if (!current) throw new Error('Message operation not found.');
    const operation: Operation = JSON.parse(current.toString());
    if (operation.fingerprint !== fingerprint) throw new Error('Message operation does not match the original message.');
    return Buffer.from(JSON.stringify({...operation, result}));
  }, {access:'private',contentType:'application/json'});
}
