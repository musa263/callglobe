import { readObject, transactObject } from '../../shared/object-store.js';
import { tenantStorageKey } from '../../shared/tenant-storage.js';
const path = (id:string) => `vocivo/number-purchases/${tenantStorageKey(id)}.json`;
export async function pendingNumberPurchases(id:string) {
  const value = await readObject(path(id));
  return value ? JSON.parse(value.toString()) as string[] : [];
}
export async function changePendingNumberPurchases(id:string, add:string[], remove:string[] = []) {
  await transactObject(path(id), current => Buffer.from(JSON.stringify([...new Set([
    ...(current ? JSON.parse(current.toString()) as string[] : []).filter(number => !remove.includes(number)), ...add,
  ])])), {access:'private',contentType:'application/json'});
}
