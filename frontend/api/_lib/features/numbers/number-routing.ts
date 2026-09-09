import { createHash } from 'node:crypto';
import { pbxForOrganization, type PbxConfig } from '../organizations/pbx-config-store.js';
import { defaultUserProfile } from '../calling/call-preferences.js';
import { validateOutgoingLine } from './dialing-defaults.js';
import { detachCompanyNumber } from './carrier-number-service.js';

export type RoutingUser = { id: string; organizationId: string; name: string; extension: string; status: string };
export class NumberRoutingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function numberRoutingSnapshot(config: PbxConfig, organizationId: string, directory: RoutingUser[]) {
  const tenant = pbxForOrganization(config, organizationId);
  const users = directory.filter(user => user.organizationId === organizationId).map(user => ({
    id: user.id, name: user.name, extension: user.extension, status: user.status,
    outboundCallerId: config.userProfiles[user.id]?.outboundCallerId || '',
  })).sort((a, b) => a.id.localeCompare(b.id));
  const numbers = Object.entries(config.numberAssignments)
    .filter(([, item]) => item.organizationId === organizationId && !item.disabled)
    .sort(([a], [b]) => a.localeCompare(b)).map(([number, item]) => ({
      number, label: item.label || '', source: item.source || (item.destinationType ? 'owned' : 'verified'),
      destinationType: item.destinationType || (item.source === 'carrier' ? 'unassigned' : 'main'),
      destinationId: item.destinationType && item.destinationType !== 'main' ? item.destinationId || '' : '',
      available: tenant.company.callingMode !== 'carrier' || item.source === 'carrier',
    }));
  const targets = [
    { type: 'main', id: '', label: 'Main line / receptionist' },
    ...users.filter(user => user.status === 'active').map(user => ({ type: 'extension', id: user.id, label: `${user.extension} - ${user.name}` })),
    ...tenant.callHandling.ringGroups.map(item => ({ type: 'ring_group', id: item.id, label: `Ring group - ${item.name}` })),
    ...tenant.callHandling.queues.map(item => ({ type: 'queue', id: item.id, label: `Queue - ${item.name}` })),
    ...tenant.callHandling.ivrs.map(item => ({ type: 'ivr', id: item.id, label: `Voice menu - ${item.name}` })),
  ];
  const data = { organizationId, defaultCallerId: tenant.company.defaultCallerId, numbers, users, targets };
  return { ...data, version: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}

/** A single PBX transaction owns direct routing and the user's caller ID. */
export function applyNumberRouting(config: PbxConfig, organizationId: string, directory: RoutingUser[], body: Record<string, unknown>) {
  if (!config.organizations.some(item => item.id === organizationId && item.status === 'active')) throw new NumberRoutingError(403, 'Organization inactive.');
  const snapshot = numberRoutingSnapshot(config, organizationId, directory);
  if (!body.version || body.version !== snapshot.version) throw new NumberRoutingError(409, 'Number assignments changed. Reload numbers before saving.');
  const numberAssignments = { ...config.numberAssignments };
  if (body.action === 'remove') {
    if (typeof body.number !== 'string' || !snapshot.numbers.some(item => item.number === body.number)) throw new NumberRoutingError(400, 'Choose a number assigned to this company.');
    return detachCompanyNumber(config, organizationId, body.number, snapshot.users.map(user => user.id));
  }
  const inbound = (number: unknown) => {
    const item = snapshot.numbers.find(item => item.number === number);
    if (!item || !item.available || item.source === 'verified') throw new NumberRoutingError(400, 'Choose an inbound number owned by this company and available in its calling mode.');
    return item;
  };
  if (body.action === 'user') {
    const user = snapshot.users.find(item => item.id === body.extensionId && item.status === 'active');
    if (!user) throw new NumberRoutingError(400, 'Choose an active user in this company.');
    if (!Array.isArray(body.inboundNumbers) || body.inboundNumbers.length > 1000 || body.inboundNumbers.some(item => typeof item !== 'string') || typeof body.outboundCallerId !== 'string') {
      throw new NumberRoutingError(400, 'Provide inbound numbers and an outbound caller ID.');
    }
    try { validateOutgoingLine(config, organizationId, body.outboundCallerId); }
    catch { throw new NumberRoutingError(400, 'Choose an enabled outgoing number assigned to this company.'); }
    const selected = new Set(body.inboundNumbers as string[]);
    for (const number of selected) {
      const item = inbound(number);
      if (item.destinationType !== 'unassigned' && !(item.destinationType === 'extension' && item.destinationId === user.id) && body.confirmReassignment !== true) {
        throw new NumberRoutingError(409, 'Confirm reassignment of numbers with an existing destination.');
      }
      numberAssignments[number] = { ...numberAssignments[number], destinationType: 'extension', destinationId: user.id };
    }
    for (const item of snapshot.numbers) {
      if (item.destinationType === 'extension' && item.destinationId === user.id && !selected.has(item.number)) {
        numberAssignments[item.number] = { ...numberAssignments[item.number], destinationType: 'main', destinationId: '' };
      }
    }
    return { numberAssignments, userProfiles: { ...config.userProfiles, [user.id]: {
      ...(config.userProfiles[user.id] || defaultUserProfile()), outboundCallerId: body.outboundCallerId, did: '',
    } } };
  }
  if (body.action === 'route') {
    const item = inbound(body.number);
    const target = snapshot.targets.find(target => target.type === body.destinationType && target.id === body.destinationId);
    if (!target) throw new NumberRoutingError(400, 'Choose a routing destination in this company.');
    numberAssignments[item.number] = { ...numberAssignments[item.number], destinationType: target.type as NonNullable<PbxConfig['numberAssignments'][string]['destinationType']>, destinationId: target.id };
    return { numberAssignments };
  }
  throw new NumberRoutingError(400, 'Choose a supported number-routing action.');
}
