import type { VoiceState } from './voice-control.js';
import { canonicalVoiceDestination, isAllowedInternalSipDestination } from './internal-sip.js';

export function parkedFlowUsesNativeBridge(flow: 'outbound' | 'internal') {
  return flow === 'internal';
}

/** One SIP URI per internal park dial so CallKit is not replaced by a sibling alias fork. */
export function parkedInternalDialTargets(reservationDestination: string, aliasDestinations: string[]) {
  if (isAllowedInternalSipDestination(reservationDestination)) return [canonicalVoiceDestination(reservationDestination)];
  return aliasDestinations.filter(Boolean);
}

export function parkedDestinationDialInput(input: {
  parkedCallControlId: string;
  destination: string;
  destinations: string[];
  flow: 'outbound' | 'internal';
  from: string;
  organizationId: string;
  routeId: string;
  sourceExtensionId?: string;
  sourceExtension?: string;
  sourceName?: string;
  sourcePhotoUrl?: string;
  destinationExtensionId?: string;
  destinationExtension?: string;
  destinationName?: string;
}) {
  const nativeBridge = parkedFlowUsesNativeBridge(input.flow);
  return {
    to: input.destinations.length > 1 ? input.destinations : (input.destinations[0] || input.destination),
    from: input.from,
    linkTo: nativeBridge ? input.parkedCallControlId : undefined,
    state: {
      flow: 'outbound_destination',
      parentCallControlId: input.parkedCallControlId,
      organizationId: input.organizationId,
      routeId: input.routeId,
      sourceExtensionId: input.sourceExtensionId,
      sourceExtension: input.sourceExtension,
      sourceName: input.sourceName,
      sourcePhotoUrl: input.sourcePhotoUrl,
      destinationExtensionId: input.destinationExtensionId,
      destinationExtension: input.destinationExtension,
      destinationName: input.destinationName,
      bridgeOnAnswer: nativeBridge,
    } satisfies VoiceState,
  };
}
