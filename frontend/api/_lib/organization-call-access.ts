import { authorizeOutboundCall } from './outbound-policy.js';
import { pbxForOrganization, readPbxConfig, type PbxConfig } from './pbx-config-store.js';
import { accessForOrganization } from './saas-access.js';
import { outboundWalletBlockReason, readTenantWallet } from './wallet-store.js';

/**
 * May this organization place this call?
 *
 * The apps ask /api/voice/route, which checks that the company is active and
 * subscribed, that the plan includes calling, that an outbound rule permits the
 * destination, and that the wallet is not empty or frozen. The platform API
 * asked none of it: a key authenticated, its caller ID was checked for
 * ownership, and the call went out — for a suspended company, on a cancelled
 * plan, against a frozen wallet, to a destination the company's own rules
 * refuse.
 *
 * A key acts for the organization rather than for a person, so it carries no
 * extension: rules scoped to an extension range are not its rules, and a
 * company whose only rules are scoped that way has no route for it.
 */

export class CallNotPermittedError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export async function assertOrganizationMayCall(organizationId: string, input: {
  flow: 'outbound' | 'internal';
  destination: string;
  callerId?: string;
  config?: PbxConfig;
}) {
  const config = input.config || await readPbxConfig();
  let access;
  try {
    access = await accessForOrganization(organizationId, config);
  } catch (error) {
    // "Organization inactive" and "Subscription inactive" both mean the same
    // thing to a caller holding a key: this company is not calling today.
    throw new CallNotPermittedError(error instanceof Error && /Subscription/i.test(error.message)
      ? 'This company’s subscription is not active.'
      : 'This company is not active.');
  }
  const feature = input.flow === 'internal' ? 'internalCalling' : 'outboundCalling';
  if (!access.features[feature]) {
    throw new CallNotPermittedError(input.flow === 'internal'
      ? 'Internal calling is not enabled for this company.'
      : 'Outbound calling is not enabled for this company.');
  }
  if (input.flow === 'internal') return access;

  const tenant = pbxForOrganization(config, organizationId);
  try {
    authorizeOutboundCall(tenant, { internationalAllowed: true }, input.destination, input.callerId || '');
  } catch (error) {
    throw new CallNotPermittedError(error instanceof Error && /outbound rule/i.test(error.message)
      ? 'No enabled outbound rule permits this call for an API key. A rule that applies to all extensions is required.'
      : error instanceof Error ? error.message : 'This call is not permitted.');
  }
  const blocked = outboundWalletBlockReason(await readTenantWallet(organizationId));
  if (blocked) throw new CallNotPermittedError(blocked, 402);
  return access;
}
