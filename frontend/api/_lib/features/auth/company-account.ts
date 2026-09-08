import { createHmac, timingSafeEqual } from 'node:crypto';
import { requiredEnv } from '../../shared/http.js';
import type { ExtensionUser } from '../organizations/pbx.js';

export type CompanyAccountRole = 'company_owner' | 'company_admin' | 'manager' | 'user';
export function isCompanyAccountRole(role: unknown): role is CompanyAccountRole {
  return ['company_owner', 'company_admin', 'manager', 'user'].includes(String(role));
}
export function isCompanyAdministrator(role: unknown) { return role === 'company_owner' || role === 'company_admin'; }
export function hasActiveAdministrator(accounts: Array<{ role: string; status: string }>) {
  return accounts.some(account => account.status === 'active' && isCompanyAdministrator(account.role));
}
export function validCompanyPassword(password: string) {
  return password.length >= 10 && Buffer.byteLength(password, 'utf8') <= 72 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}
export function accountCredentialVersion(hash: string) {
  return createHmac('sha256', requiredEnv('AUTH_SECRET')).update(`credential-session:v1:${hash}`).digest('hex');
}
export function assertAccountCredentialVersion(presented: unknown, account: { role: string; passwordHash: string }) {
  // Existing administrator sessions expire normally; all new logins carry the binding.
  if (presented === undefined && isCompanyAdministrator(account.role)) return;
  const expected = accountCredentialVersion(account.passwordHash);
  if (typeof presented !== 'string' || !/^[a-f0-9]{64}$/.test(presented)
    || !timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(expected, 'hex'))) throw new Error('Unauthorized');
}
export function assertCompanyAccountIdentity(account: { role: string; organizationId: string; extensionId?: string; extension?: string }, extension: ExtensionUser | null) {
  if (!isCompanyAccountRole(account.role)) throw new Error('Unauthorized');
  if (!account.extensionId) { if (!isCompanyAdministrator(account.role)) throw new Error('Unauthorized'); return; }
  if (!extension || extension.id !== account.extensionId || extension.organizationId !== account.organizationId
    || extension.status !== 'active' || extension.role !== account.role || extension.extension !== account.extension) throw new Error('Unauthorized');
}
