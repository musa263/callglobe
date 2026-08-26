import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { put } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';
import { requiredEnv } from './http.js';
import type { PbxConfig } from './pbx-config-store.js';

export const featureCatalog = [
  { id: 'internalCalling', name: 'Internal extension calling', group: 'Calling' },
  { id: 'outboundCalling', name: 'External and international calling', group: 'Calling' },
  { id: 'sms', name: 'SMS messaging', group: 'Communications' },
  { id: 'phoneNumbers', name: 'Phone-number purchasing and routing', group: 'Communications' },
  { id: 'sipTrunks', name: 'SIP trunk management', group: 'Connectivity' },
  { id: 'aiReceptionist', name: 'Interactive AI receptionist', group: 'Automation' },
  { id: 'videoCalling', name: 'Video calling', group: 'Calling' },
  { id: 'callRecording', name: 'Call recording', group: 'Compliance' },
  { id: 'voicemail', name: 'Voicemail and transcription', group: 'Calling' },
  { id: 'queues', name: 'Queues and ring groups', group: 'Routing' },
  { id: 'ivr', name: 'IVR voice menus', group: 'Routing' },
  { id: 'analytics', name: 'Reports and analytics', group: 'Insights' },
  { id: 'developerApi', name: 'Developer API access', group: 'Platform' },
  { id: 'customBranding', name: 'Custom company branding', group: 'Experience' },
] as const;

export type FeatureKey = typeof featureCatalog[number]['id'];
export type FeatureSet = Record<FeatureKey, boolean>;
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';

export type SaasPlan = {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  limits: { seats: number; phoneNumbers: number; concurrentCalls: number; storageDays: number };
  features: FeatureSet;
  active: boolean;
};

export type SaasSubscription = {
  organizationId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: 'monthly' | 'annual' | 'custom';
  amount: number;
  currency: string;
  startsAt: string;
  trialEndsAt: string;
  renewsAt: string;
  cancelAtPeriodEnd: boolean;
  externalCustomerId: string;
  notes: string;
};

export type TenantAdminAccount = {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: 'company_owner' | 'company_admin';
  passwordHash: string;
  status: 'active' | 'suspended';
  forcePasswordChange: boolean;
  extensionId?: string;
  extension?: string;
  createdAt: string;
  updatedAt: string;
};

export type SaasState = {
  version: number;
  plans: SaasPlan[];
  subscriptions: Record<string, SaasSubscription>;
  featureOverrides: Record<string, Partial<FeatureSet>>;
  tenantAdmins: TenantAdminAccount[];
  updatedAt: string;
};

const pathname = 'vocivo/saas/state.bin';
const cacheTtlMs = 15_000;
let cachedStoredState: { expiresAt: number; value?: Partial<SaasState> } | null = null;
let stateRequest: Promise<Partial<SaasState> | undefined> | null = null;
const featureKeys = featureCatalog.map((feature) => feature.id);
const allFeatures = (enabled = false) => Object.fromEntries(featureKeys.map((key) => [key, enabled])) as FeatureSet;
const withFeatures = (...enabled: FeatureKey[]) => ({ ...allFeatures(false), ...Object.fromEntries(enabled.map((key) => [key, true])) });

export function defaultPlans(): SaasPlan[] {
  return [
    {
      id: 'starter', name: 'Starter', description: 'Essential cloud calling for small teams.', monthlyPrice: 29, annualPrice: 290, currency: 'USD', active: true,
      limits: { seats: 5, phoneNumbers: 2, concurrentCalls: 3, storageDays: 30 },
      features: withFeatures('internalCalling', 'outboundCalling', 'sms', 'phoneNumbers', 'voicemail'),
    },
    {
      id: 'business', name: 'Business', description: 'Advanced routing, automation and reporting for growing companies.', monthlyPrice: 99, annualPrice: 990, currency: 'USD', active: true,
      limits: { seats: 25, phoneNumbers: 10, concurrentCalls: 15, storageDays: 180 },
      features: withFeatures('internalCalling', 'outboundCalling', 'sms', 'phoneNumbers', 'sipTrunks', 'aiReceptionist', 'videoCalling', 'voicemail', 'queues', 'ivr', 'analytics', 'customBranding'),
    },
    {
      id: 'enterprise', name: 'Enterprise', description: 'Full communications control with custom capacity and governance.', monthlyPrice: 299, annualPrice: 2990, currency: 'USD', active: true,
      limits: { seats: 250, phoneNumbers: 100, concurrentCalls: 100, storageDays: 365 },
      features: allFeatures(true),
    },
  ];
}

function defaultSubscription(organizationId: string, accountType: 'business' | 'individual' = 'business'): SaasSubscription {
  const now = new Date();
  const renews = new Date(now);
  renews.setUTCMonth(renews.getUTCMonth() + 1);
  return {
    organizationId,
    planId: accountType === 'business' ? 'business' : 'starter',
    status: 'active',
    billingCycle: 'monthly',
    amount: accountType === 'business' ? 99 : 29,
    currency: 'USD',
    startsAt: now.toISOString(),
    trialEndsAt: '',
    renewsAt: renews.toISOString(),
    cancelAtPeriodEnd: false,
    externalCustomerId: '',
    notes: '',
  };
}

export function defaultSaasState(config?: PbxConfig): SaasState {
  const organizations = config?.organizations || [];
  return {
    version: 1,
    plans: defaultPlans(),
    subscriptions: Object.fromEntries(organizations.map((organization) => [organization.id, defaultSubscription(organization.id, organization.accountType)])),
    featureOverrides: {},
    tenantAdmins: [],
    updatedAt: new Date().toISOString(),
  };
}

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:saas`).digest(); }
function encrypt(value: SaasState) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as SaasState;
}

function cleanFeatureSet(value?: Partial<FeatureSet>) {
  return Object.fromEntries(featureKeys.map((feature) => [feature, Boolean(value?.[feature])])) as FeatureSet;
}

function mergeState(stored: Partial<SaasState> | undefined, config?: PbxConfig): SaasState {
  const base = defaultSaasState(config);
  const plans = stored?.plans?.length ? stored.plans.map((plan) => ({ ...plan, features: cleanFeatureSet(plan.features) })) : base.plans;
  const subscriptions = { ...base.subscriptions, ...(stored?.subscriptions || {}) };
  return {
    ...base,
    ...stored,
    plans,
    subscriptions,
    featureOverrides: stored?.featureOverrides || {},
    tenantAdmins: stored?.tenantAdmins || [],
    updatedAt: stored?.updatedAt || base.updatedAt,
  };
}

export async function readSaasState(config?: PbxConfig) {
  if (!cachedStoredState || cachedStoredState.expiresAt <= Date.now()) {
    stateRequest ||= (async () => {
      const value = await readStoredObject(pathname);
      const stored = value ? decrypt(value) : undefined;
      cachedStoredState = { expiresAt: Date.now() + cacheTtlMs, value: stored };
      return stored;
    })().finally(() => { stateRequest = null; });
    await stateRequest;
  }
  return mergeState(cachedStoredState?.value, config);
}

export async function saveSaasState(input: Partial<SaasState>, config?: PbxConfig) {
  const current = await readSaasState(config);
  const next = mergeState({ ...current, ...input, updatedAt: new Date().toISOString() }, config);
  const organizationIds = new Set(config?.organizations.map((organization) => organization.id) || Object.keys(next.subscriptions));
  for (const subscription of Object.values(next.subscriptions)) {
    if (!organizationIds.has(subscription.organizationId)) throw new Error('Subscription organization was not found.');
    if (!next.plans.some((plan) => plan.id === subscription.planId && plan.active)) throw new Error('Choose an active subscription plan.');
  }
  for (const account of next.tenantAdmins) {
    if (!organizationIds.has(account.organizationId)) throw new Error('Administrator organization was not found.');
  }
  await put(pathname, encrypt(next), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
  cachedStoredState = { expiresAt: Date.now() + cacheTtlMs, value: next };
  return next;
}

export function effectiveEntitlements(state: SaasState, organizationId: string, accountType: 'business' | 'individual' = 'business') {
  const subscription = state.subscriptions[organizationId] || defaultSubscription(organizationId, accountType);
  const plan = state.plans.find((item) => item.id === subscription.planId) || state.plans[0] || defaultPlans()[0];
  const serviceActive = ['active', 'trialing'].includes(subscription.status);
  const features = Object.fromEntries(featureKeys.map((feature) => [feature, serviceActive && Boolean(state.featureOverrides[organizationId]?.[feature] ?? plan.features[feature])])) as FeatureSet;
  if (accountType === 'individual') features.internalCalling = false;
  return { subscription, plan, features, serviceActive };
}

export function publicTenantAdmin(account: TenantAdminAccount) {
  const { passwordHash: _passwordHash, ...safe } = account;
  return safe;
}

export async function findTenantAdminByEmail(email: string, config?: PbxConfig) {
  const state = await readSaasState(config);
  return state.tenantAdmins.find((account) => account.email === email.trim().toLowerCase()) || null;
}

export async function findTenantAdminForExtension(extensionId: string, config?: PbxConfig) {
  const state = await readSaasState(config);
  return state.tenantAdmins.find((account) => account.extensionId === extensionId) || null;
}

export async function authenticateTenantAdmin(email: string, password: string, config?: PbxConfig) {
  const account = await findTenantAdminByEmail(email, config);
  if (!account || account.status !== 'active' || !await bcrypt.compare(password, account.passwordHash)) return null;
  return account;
}

function validPassword(password: string) {
  return password.length >= 10 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

export async function saveTenantAdmin(input: Partial<TenantAdminAccount> & { password?: string }, config: PbxConfig) {
  const state = await readSaasState(config);
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim().slice(0, 80);
  const organizationId = String(input.organizationId || '').trim();
  const existing = input.id
    ? state.tenantAdmins.find((account) => account.id === input.id)
    : input.extensionId
      ? state.tenantAdmins.find((account) => account.extensionId === input.extensionId) || state.tenantAdmins.find((account) => account.email === email)
      : state.tenantAdmins.find((account) => account.email === email);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid administrator email.');
  if (!name) throw new Error('Administrator name is required.');
  if (!config.organizations.some((organization) => organization.id === organizationId)) throw new Error('Administrator organization was not found.');
  if (!existing && !validPassword(input.password || '')) throw new Error('Temporary password must have 10 characters, upper and lowercase letters, and a number.');
  if (input.password && !validPassword(input.password)) throw new Error('Temporary password must have 10 characters, upper and lowercase letters, and a number.');
  const duplicate = state.tenantAdmins.find((account) => account.email === email && account.id !== existing?.id);
  if (duplicate) throw new Error('This email already belongs to another customer administrator.');
  const now = new Date().toISOString();
  const account: TenantAdminAccount = {
    id: existing?.id || randomUUID(),
    organizationId,
    email,
    name,
    role: input.role === 'company_admin' ? 'company_admin' : 'company_owner',
    passwordHash: input.password ? await bcrypt.hash(input.password, 12) : existing?.passwordHash || '',
    status: input.status === 'suspended' ? 'suspended' : 'active',
    forcePasswordChange: input.password ? input.forcePasswordChange !== false : existing?.forcePasswordChange ?? true,
    extensionId: input.extensionId || existing?.extensionId,
    extension: input.extension || existing?.extension,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const tenantAdmins = [...state.tenantAdmins.filter((item) => item.id !== account.id), account];
  const organization = config.organizations.find((item) => item.id === organizationId);
  if (organization?.accountType === 'business' && !tenantAdmins.some((item) => item.organizationId === organizationId && item.status === 'active')) throw new Error('Business customers require at least one active company administrator.');
  await saveSaasState({ tenantAdmins }, config);
  return account;
}

export async function changeTenantAdminPassword(accountId: string, currentPassword: string, newPassword: string, config: PbxConfig) {
  if (!validPassword(newPassword)) throw new Error('Use at least 10 characters with upper and lowercase letters and a number.');
  const state = await readSaasState(config);
  const account = state.tenantAdmins.find((item) => item.id === accountId);
  if (!account || !await bcrypt.compare(currentPassword, account.passwordHash)) return false;
  const next = { ...account, passwordHash: await bcrypt.hash(newPassword, 12), forcePasswordChange: false, updatedAt: new Date().toISOString() };
  await saveSaasState({ tenantAdmins: state.tenantAdmins.map((item) => item.id === accountId ? next : item) }, config);
  return true;
}

export async function activeTenantAdmin(accountId: string, config?: PbxConfig) {
  const state = await readSaasState(config);
  return state.tenantAdmins.find((account) => account.id === accountId && account.status === 'active') || null;
}

export async function removeTenantAdminForExtension(extensionId: string, config: PbxConfig) {
  const state = await readSaasState(config);
  const next = state.tenantAdmins.filter((account) => account.extensionId !== extensionId);
  if (next.length !== state.tenantAdmins.length) await saveSaasState({ tenantAdmins: next }, config);
}

export function createSubscription(organizationId: string, planId: string, state: SaasState, patch: Partial<SaasSubscription> = {}) {
  const plan = state.plans.find((item) => item.id === planId && item.active);
  if (!plan) throw new Error('Choose an active subscription plan.');
  const merged = {
    ...defaultSubscription(organizationId),
    ...state.subscriptions[organizationId],
    amount: plan.monthlyPrice,
    currency: plan.currency,
    ...patch,
    organizationId,
    planId: plan.id,
  } as SaasSubscription;
  const statuses: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'suspended', 'canceled'];
  const cycles: SaasSubscription['billingCycle'][] = ['monthly', 'annual', 'custom'];
  const validIso = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
  return {
    ...merged,
    status: statuses.includes(merged.status) ? merged.status : 'active',
    billingCycle: cycles.includes(merged.billingCycle) ? merged.billingCycle : 'monthly',
    amount: Number.isFinite(Number(merged.amount)) && Number(merged.amount) >= 0 ? Math.round(Number(merged.amount) * 100) / 100 : plan.monthlyPrice,
    currency: String(merged.currency || plan.currency).trim().toUpperCase().slice(0, 3) || 'USD',
    startsAt: validIso(merged.startsAt) || defaultSubscription(organizationId).startsAt,
    trialEndsAt: validIso(merged.trialEndsAt),
    renewsAt: validIso(merged.renewsAt),
    cancelAtPeriodEnd: Boolean(merged.cancelAtPeriodEnd),
    externalCustomerId: String(merged.externalCustomerId || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120),
    notes: String(merged.notes || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500),
  };
}
