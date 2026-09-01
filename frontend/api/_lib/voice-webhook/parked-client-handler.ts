import { readBusinessVoiceConfig } from '../number-config.js';
import { listExtensionSipUsernames } from '../pbx.js';
import { accessForOrganization } from '../saas-access.js';
import { destinationSipUrisForInternalDial, isAllowedInternalSipDestination, voiceDestinationsMatch } from '../internal-sip.js';
import { saveOutboundCallPair } from '../outbound-call-store.js';
import { terminateOutboundPair } from '../outbound-cancel.js';
import { parkedDestinationDialInput, parkedFlowUsesNativeBridge, parkedInternalDialTargets } from '../parked-destination-dial.js';
import { callAction, dialCall, dialCallLegs, primaryVoiceCallerId } from '../voice-control.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { readVoiceRoute, updateVoiceRoute } from '../voice-route-store.js';
import { verifyVoiceRouteToken } from '../voice-route-token.js';
import { resolveParkedReservation } from '../voice-routing.js';
import type { VoicePayload } from './contracts.js';
import { background, callerDisplay, customHeader, logWebhookFailure } from './support.js';

const e164 = /^\+[1-9]\d{6,14}$/;

type ParkedClientInput = {
  callControlId: string;
  eventId: string;
  parkedFlow: string;
  payload: VoicePayload;
};

function invalidReservationReason(input: {
  destination: string;
  effectiveCallerId: string;
  observedDestination: string;
  parkedFlow: string;
  reservation: {
    destination: string;
    flow: 'outbound' | 'internal';
    callerId?: string;
  };
}) {
  if (!voiceDestinationsMatch(input.reservation.destination, input.observedDestination)) return 'destination_mismatch';
  if (input.reservation.flow !== input.parkedFlow) return 'flow_mismatch';
  if ((input.reservation.callerId || '') !== input.effectiveCallerId) return 'caller_identity_mismatch';
  if (!e164.test(input.destination) && !isAllowedInternalSipDestination(input.destination)) return 'unsupported_destination';
  return '';
}

async function rejectParkedCall(callControlId: string, eventId: string, command: string, operation: string) {
  await callAction(callControlId, 'hangup', { command_id: `${eventId}-${command}` })
    .catch((error) => logWebhookFailure(operation, error));
}

export async function handleParkedClientInitiated({ callControlId, eventId, parkedFlow, payload }: ParkedClientInput) {
  const observedDestination = customHeader(payload, 'X-Vocivo-Destination') || payload.to || '';
  const selectedCallerId = customHeader(payload, 'X-Vocivo-Caller-ID');
  const requestedRouteId = customHeader(payload, 'X-Vocivo-Route-ID');
  const routeId = isVoiceRouteId(requestedRouteId) ? requestedRouteId : '';
  const signedReservation = verifyVoiceRouteToken(customHeader(payload, 'X-Vocivo-Route-Token'));
  const storedRoute = routeId ? await readVoiceRoute(routeId) : null;
  const resolved = resolveParkedReservation({
    routeId,
    signedReservation,
    storedRoute,
  });
  const reservation = resolved.reservation;
  if (!reservation) {
    console.warn('Vocivo rejected a parked call route', { eventId, routeId, flow: parkedFlow, reason: resolved.reason || 'missing_reservation' });
    await rejectParkedCall(callControlId, eventId, 'invalid-destination', 'hang up invalid destination');
    return;
  }

  const effectiveCallerId = selectedCallerId || reservation.callerId || '';
  const destination = reservation.destination;
  const invalidReason = invalidReservationReason({
    destination,
    effectiveCallerId,
    observedDestination,
    parkedFlow,
    reservation,
  });
  if (invalidReason) {
    console.warn('Vocivo rejected a parked call route', { eventId, routeId, flow: parkedFlow, reason: invalidReason });
    await rejectParkedCall(callControlId, eventId, 'invalid-destination', 'hang up invalid destination');
    return;
  }

  try {
    const access = await accessForOrganization(reservation.organizationId);
    const feature = reservation.flow === 'internal' ? 'internalCalling' : 'outboundCalling';
    if (!access.features[feature]) throw new Error('Feature not enabled');
  } catch (error) {
    logWebhookFailure('verify tenant outbound entitlement', error);
    await rejectParkedCall(callControlId, eventId, 'service-unavailable', 'hang up unavailable service');
    return;
  }

  const destinationPreparation = Promise.all([
    reservation.flow === 'internal'
      ? readBusinessVoiceConfig(reservation.organizationId).then((config) => config.companyName)
      : Promise.resolve(''),
    reservation.flow === 'internal' && reservation.destinationExtensionId
      ? listExtensionSipUsernames(reservation.destinationExtensionId)
      : Promise.resolve([]),
    reservation.flow === 'internal' && reservation.sourceExtensionId
      ? listExtensionSipUsernames(reservation.sourceExtensionId)
      : Promise.resolve([]),
    reservation.flow === 'internal' ? primaryVoiceCallerId() : Promise.resolve(reservation.callerId),
  ]).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

  // Keep the parked caller unanswered until the destination answers. Answering
  // here started Telnyx Call Control minutes for ringback. The destination
  // Dial is an independent Call Control call and does not need the caller answered.
  let destinationCall;
  try {
    const prepared = await destinationPreparation;
    if ('error' in prepared) throw prepared.error;
    const [businessName, sipUsers, sourceSipUsers, resolvedVoiceCallerId] = prepared.value;
    const aliasDestinations = destinationSipUrisForInternalDial(sipUsers, sourceSipUsers, destination);
    const destinations = parkedInternalDialTargets(destination, aliasDestinations);
    if (!resolvedVoiceCallerId) throw new Error('The signed call route has no authorized caller identity.');
    if (reservation.flow === 'internal' && !destinations.length) throw new Error('The internal destination has no reachable SIP alias.');
    const destinationDial = parkedDestinationDialInput({
      parkedCallControlId: callControlId,
      destination,
      destinations,
      flow: reservation.flow,
      from: resolvedVoiceCallerId,
      organizationId: reservation.organizationId,
      routeId,
      sourceExtensionId: reservation.sourceExtensionId,
      sourceExtension: reservation.callerExtension,
      sourceName: reservation.callerName,
      sourcePhotoUrl: reservation.callerPhotoUrl,
      destinationExtensionId: reservation.destinationExtensionId,
      destinationExtension: reservation.destinationExtension,
      destinationName: reservation.destinationName,
    });
    destinationCall = await dialCall({
      ...destinationDial,
      fromDisplayName: callerDisplay(reservation.flow === 'internal' && reservation.callerName
        ? `${reservation.callerName}${reservation.callerExtension ? ` - Ext ${reservation.callerExtension}` : ''}`
        : payload.caller_id_name || 'Vocivo'),
      customHeaders: reservation.flow === 'internal' ? [
        { name: 'X-Vocivo-Call-Type', value: 'internal' },
        { name: 'X-Vocivo-Route-ID', value: routeId },
        ...(reservation.callerName ? [{ name: 'X-Vocivo-Caller-Name', value: reservation.callerName }] : []),
        ...(reservation.callerExtension ? [{ name: 'X-Vocivo-Caller-Extension', value: reservation.callerExtension }] : []),
        ...(reservation.callerPhotoUrl ? [{ name: 'X-Vocivo-Caller-Photo', value: reservation.callerPhotoUrl }] : []),
        ...(businessName ? [{ name: 'X-Vocivo-Company-Name', value: businessName }] : []),
        { name: 'X-Vocivo-Organization-ID', value: reservation.organizationId },
      ] : undefined,
      commandId: `${eventId}-destination`,
    });
  } catch (dialError) {
    background('failed route state', updateVoiceRoute(routeId, {
      phase: 'failed',
      failureCause: dialError instanceof Error ? dialError.message : 'destination_dial_failed',
    }));
    await rejectParkedCall(callControlId, eventId, 'dial-failed', 'hang up failed dial');
    return;
  }

  const destinationCallControlIds = dialCallLegs(destinationCall)
    .map((leg) => leg.call_control_id)
    .filter((id): id is string => Boolean(id));
  if (!destinationCallControlIds.length) {
    // Telnyx may only identify forked child legs in their initiated webhooks.
    const updatedRoute = await updateVoiceRoute(routeId, { phase: 'ringing' });
    if (updatedRoute && ['ended', 'failed'].includes(updatedRoute.phase)) {
      await rejectParkedCall(callControlId, eventId, 'canceled', 'hang up canceled parked client');
    }
    return;
  }

  const pair = {
    clientCallControlId: callControlId,
    destinationCallControlId: destinationCallControlIds[0],
    forkDestinationCallControlIds: destinationCallControlIds,
    routeId,
    destination,
    status: 'direct' as const,
    phase: 'ringing' as const,
    bridgeOnAnswer: parkedFlowUsesNativeBridge(reservation.flow),
    updatedAt: new Date().toISOString(),
  };
  await saveOutboundCallPair(pair);
  const updatedRoute = await updateVoiceRoute(routeId, { phase: 'ringing' });
  if (updatedRoute && ['ended', 'failed'].includes(updatedRoute.phase)) {
    await terminateOutboundPair(pair, `${eventId}-canceled`);
  }
}
