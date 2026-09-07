import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  del,
  deleteAllTenantSaasAdmins,
  deleteTenantSaasAdmin,
  deleteTenantSaasAdminsForExtension,
  findSaasAdminByEmailForAuthentication,
  initializeSaasRows,
  readPlatformSaasRows,
  readSaasPlanRows,
  readTenantSaasRows,
  upsertSaasPlan,
  upsertTenantSaasAdmin,
  upsertTenantSaasOverrides,
  upsertTenantSaasRow,
  type SaasAdminRow,
  type SaasPlanRow,
  type SaasRows,
  type SaasTenantRow,
} from '../../shared/object-store.js';
import { readStoredObject } from '../../shared/stored-object-read.js';
import { requiredEnv } from '../../shared/http.js';
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
// Account classification is a boundary, not a plan override or client preference.
export const businessOnlyFeatures: readonly FeatureKey[] = ['internalCalling', 'sipTrunks', 'aiReceptionist', 'callRecording', 'queues', 'ivr', 'analytics', 'developerApi', 'customBranding'];
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

const legacyPathname = 'vocivo/saas/state.bin';
let migrationRequest: Promise<void> | null = null;
let migrationReady = false;
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

function iso(value: Date | string | null | undefined) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function planRow(plan: SaasPlan): SaasPlanRow {
  return {
    plan_id: plan.id,
    name: plan.name,
    description: plan.description,
    monthly_price: plan.monthlyPrice,
    annual_price: plan.annualPrice,
    currency: plan.currency,
    seat_limit: plan.limits.seats,
    phone_number_limit: plan.limits.phoneNumbers,
    concurrent_call_limit: plan.limits.concurrentCalls,
    storage_days: plan.limits.storageDays,
    features: plan.features,
    active: plan.active,
  };
}

function tenantRow(subscription: SaasSubscription, overrides: Partial<FeatureSet> = {}): SaasTenantRow {
  return {
    organization_id: subscription.organizationId,
    plan_id: subscription.planId,
    status: subscription.status,
    billing_cycle: subscription.billingCycle,
    amount: subscription.amount,
    currency: subscription.currency,
    starts_at: subscription.startsAt,
    trial_ends_at: subscription.trialEndsAt || null,
    renews_at: subscription.renewsAt || null,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    external_customer_id: subscription.externalCustomerId,
    notes: subscription.notes,
    feature_overrides: overrides as Record<string, boolean>,
  };
}

function adminRow(account: TenantAdminAccount): SaasAdminRow {
  return {
    id: account.id,
    organization_id: account.organizationId,
    email: account.email,
    name: account.name,
    role: account.role,
    password_hash: account.passwordHash,
    status: account.status,
    force_password_change: account.forcePasswordChange,
    extension_id: account.extensionId || null,
    extension: account.extension || null,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

function rowsFromState(state: SaasState): SaasRows {
  return {
    plans: state.plans.map(planRow),
    tenants: Object.values(state.subscriptions).map((subscription) => tenantRow(subscription, state.featureOverrides[subscription.organizationId])),
    admins: state.tenantAdmins.map(adminRow),
  };
}

function stateFromRows(rows: SaasRows, config?: PbxConfig): SaasState {
  const plans = rows.plans.map((row) => ({
    id: row.plan_id,
    name: row.name,
    description: row.description,
    monthlyPrice: Number(row.monthly_price),
    annualPrice: Number(row.annual_price),
    currency: row.currency,
    limits: {
      seats: row.seat_limit,
      phoneNumbers: row.phone_number_limit,
      concurrentCalls: row.concurrent_call_limit,
      storageDays: row.storage_days,
    },
    features: cleanFeatureSet(row.features),
    active: row.active,
  }));
  const subscriptions = Object.fromEntries(rows.tenants.map((row) => [row.organization_id, {
    organizationId: row.organization_id,
    planId: row.plan_id,
    status: row.status as SubscriptionStatus,
    billingCycle: row.billing_cycle as SaasSubscription['billingCycle'],
    amount: Number(row.amount),
    currency: row.currency,
    startsAt: iso(row.starts_at),
    trialEndsAt: iso(row.trial_ends_at),
    renewsAt: iso(row.renews_at),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    externalCustomerId: row.external_customer_id,
    notes: row.notes,
  } satisfies SaasSubscription]));
  const featureOverrides = Object.fromEntries(rows.tenants.map((row) => [row.organization_id, row.feature_overrides || {}]));
  const tenantAdmins = rows.admins.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    name: row.name,
    role: row.role as TenantAdminAccount['role'],
    passwordHash: row.password_hash,
    status: row.status as TenantAdminAccount['status'],
    forcePasswordChange: row.force_password_change,
    extensionId: row.extension_id || undefined,
    extension: row.extension || undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
  return mergeState({ plans, subscriptions, featureOverrides, tenantAdmins, updatedAt: new Date().toISOString() }, config);
}

async function ensureSaasRows(config?: PbxConfig) {
  if (migrationReady) return;
  migrationRequest ||= (async () => {
    let legacy: SaasState | undefined;
    const value = await readStoredObject(legacyPathname);
    if (value) {
      try {
        legacy = decrypt(value);
      } catch (error) {
        console.error('[saas-store] Legacy state migration failed to decrypt.', error);
      }
    }
    const seeded = await initializeSaasRows(rowsFromState(mergeState(legacy, config)));
    if (seeded && value) await del(legacyPathname);
    migrationReady = true;
  })().finally(() => { migrationRequest = null; });
  await migrationRequest;
}

export async function readPlatformSaasState(config?: PbxConfig) {
  await ensureSaasRows(config);
  return stateFromRows(await readPlatformSaasRows(), config);
}

export async function readSignupPlans() {
  await ensureSaasRows();
  return stateFromRows({ plans: await readSaasPlanRows(), tenants: [], admins: [] }).plans;
}

export async function readTenantSaasState(organizationId: string, config?: PbxConfig, options: { initialize?: boolean } = {}) {
  if (!organizationId || (config && !config.organizations.some((organization) => organization.id === organizationId))) {
    throw new Error('Tenant organization was not found.');
  }
  if (options.initialize !== false) await ensureSaasRows(config);
  const tenantConfig = config ? { ...config, organizations: config.organizations.filter((organization) => organization.id === organizationId) } : undefined;
  return stateFromRows(await readTenantSaasRows(organizationId, options), tenantConfig);
}

export async function saveSaasSubscription(organizationId: string, subscription: SaasSubscription, config: PbxConfig) {
  if (subscription.organizationId !== organizationId || !config.organizations.some((organization) => organization.id === organizationId)) throw new Error('Subscription organization was not found.');
  const state = await readTenantSaasState(organizationId, config);
  if (!state.plans.some((plan) => plan.id === subscription.planId && plan.active)) throw new Error('Choose an active subscription plan.');
  const sanitized = createSubscription(organizationId, subscription.planId, state, subscription);
  await upsertTenantSaasRow(organizationId, tenantRow(sanitized, state.featureOverrides[organizationId]));
}

export async function saveSaasFeatureOverrides(organizationId: string, overrides: Partial<FeatureSet>, config: PbxConfig) {
  await readTenantSaasState(organizationId, config);
  await upsertTenantSaasOverrides(organizationId, overrides as Record<string, boolean>);
}

export async function saveSaasPlan(plan: SaasPlan, config?: PbxConfig) {
  await ensureSaasRows(config);
  await upsertSaasPlan(planRow(plan));
}

export function effectiveEntitlements(state: SaasState, organizationId: string, accountType: 'business' | 'individual' = 'business') {
  const subscription = state.subscriptions[organizationId] || defaultSubscription(organizationId, accountType);
  const plan = state.plans.find((item) => item.id === subscription.planId) || state.plans[0] || defaultPlans()[0];
  if (plan.id !== subscription.planId) console.warn(`[saas-store] Unknown plan "${subscription.planId}" for organization "${organizationId}"; falling back to plan "${plan.id}".`);
  const serviceActive = ['active', 'trialing'].includes(subscription.status);
  const features = Object.fromEntries(featureKeys.map((feature) => [feature, serviceActive && Boolean(state.featureOverrides[organizationId]?.[feature] ?? plan.features[feature])])) as FeatureSet;
  if (accountType === 'individual') for (const feature of businessOnlyFeatures) features[feature] = false;
  return { subscription, plan, features, serviceActive };
}

export function publicTenantAdmin(account: TenantAdminAccount) {
  const { passwordHash: _passwordHash, ...safe } = account;
  return safe;
}

export async function findTenantAdminByEmail(email: string, config?: PbxConfig) {
  await ensureSaasRows(config);
  const row = await findSaasAdminByEmailForAuthentication(email);
  return row ? stateFromRows({ plans: [], tenants: [], admins: [row] }).tenantAdmins[0] : null;
}

export async function findTenantAdminForExtension(extensionId: string, organizationId: string, config?: PbxConfig) {
  const state = await readTenantSaasState(organizationId, config);
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
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim().slice(0, 80);
  const organizationId = String(input.organizationId || '').trim();
  const state = await readTenantSaasState(organizationId, config);
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
  const duplicate = await findTenantAdminByEmail(email, config);
  if (duplicate && duplicate.id !== existing?.id) throw new Error('This email already belongs to another customer administrator.');
  const now = new Date().toISOString();
  const account: TenantAdminAccount = {
    id: existing?.id || randomUUID(),
    organizationId,
    email,
    name,
    role: input.role === 'company_admin' || input.role === 'company_owner' ? input.role : existing?.role || 'company_owner',
    passwordHash: input.password ? await bcrypt.hash(input.password, 12) : existing?.passwordHash || '',
    status: input.status === 'suspended' || input.status === 'active' ? input.status : existing?.status || 'active',
    forcePasswordChange: input.password ? input.forcePasswordChange !== false : existing?.forcePasswordChange ?? true,
    extensionId: input.extensionId || existing?.extensionId,
    extension: input.extension || existing?.extension,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const tenantAdmins = [...state.tenantAdmins.filter((item) => item.id !== account.id), account];
  const organization = config.organizations.find((item) => item.id === organizationId);
  if (organization?.accountType === 'business' && !tenantAdmins.some((item) => item.organizationId === organizationId && item.status === 'active')) throw new Error('Business customers require at least one active company administrator.');
  await upsertTenantSaasAdmin(organizationId, adminRow(account));
  return account;
}

export async function changeTenantAdminPassword(accountId: string, organizationId: string, currentPassword: string, newPassword: string, config: PbxConfig) {
  if (!validPassword(newPassword)) throw new Error('Use at least 10 characters with upper and lowercase letters and a number.');
  const state = await readTenantSaasState(organizationId, config);
  const account = state.tenantAdmins.find((item) => item.id === accountId);
  if (!account || !await bcrypt.compare(currentPassword, account.passwordHash)) return false;
  const next = { ...account, passwordHash: await bcrypt.hash(newPassword, 12), forcePasswordChange: false, updatedAt: new Date().toISOString() };
  await upsertTenantSaasAdmin(organizationId, adminRow(next));
  return true;
}

export async function activeTenantAdmin(accountId: string, organizationId: string, config?: PbxConfig) {
  const state = await readTenantSaasState(organizationId, config);
  return state.tenantAdmins.find((account) => account.id === accountId && account.status === 'active') || null;
}

export async function removeTenantAdminForExtension(extensionId: string, organizationId: string, config: PbxConfig) {
  const state = await readTenantSaasState(organizationId, config);
  const removing = state.tenantAdmins.some((item) => item.extensionId === extensionId);
  const remaining = state.tenantAdmins.filter((item) => item.extensionId !== extensionId);
  const organization = config.organizations.find((item) => item.id === organizationId);
  if (removing && organization?.accountType === 'business' && !remaining.some((item) => item.organizationId === organizationId && item.status === 'active')) throw new Error('Business customers require at least one active company administrator.');
  await deleteTenantSaasAdminsForExtension(organizationId, extensionId);
}

export async function removeAllTenantAdmins(organizationId: string, config: PbxConfig) {
  await readTenantSaasState(organizationId, config);
  await deleteAllTenantSaasAdmins(organizationId);
}

export async function removeTenantAdmin(accountId: string, organizationId: string, config: PbxConfig) {
  const state = await readTenantSaasState(organizationId, config);
  const account = state.tenantAdmins.find((item) => item.id === accountId);
  if (!account) return false;
  const remaining = state.tenantAdmins.filter((item) => item.id !== accountId);
  const organization = config.organizations.find((item) => item.id === organizationId);
  if (organization?.accountType === 'business' && !remaining.some((item) => item.organizationId === organizationId && item.status === 'active')) throw new Error('Business customers require at least one active company administrator.');
  return deleteTenantSaasAdmin(organizationId, accountId);
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
