export function userNumberSummary(config, extensionId) {
  const assignments = config?.numberAssignments || {};
  const owned = item => item?.organizationId === config?.activeOrganizationId && !item?.disabled;
  const inbound = Object.entries(assignments).filter(([, item]) => owned(item) && item.destinationType === 'extension' && item.destinationId === extensionId).map(([number]) => number).sort();
  const assigned = config?.userProfiles?.[extensionId]?.outboundCallerId || '';
  const outbound = assigned || config?.company?.defaultCallerId || '';
  const line = assignments[outbound];
  const available = owned(line) && (config?.company?.callingMode !== 'carrier' || line?.source === 'carrier');
  return { inbound, outbound, inherited: !assigned, unavailable: Boolean(outbound && !available) };
}
