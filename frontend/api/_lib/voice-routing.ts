type InboundRouteInput = {
  connectionId?: string;
  callControlApplicationId: string;
  hasManagedState: boolean;
};

function sameValue(value: string | undefined, expected: string) {
  return String(value || '').trim() === expected.trim();
}

function targetsInboundApplication(input: InboundRouteInput) {
  return sameValue(input.connectionId, input.callControlApplicationId)
    && !input.hasManagedState;
}

export function isInboundCallInitiated(input: InboundRouteInput & { direction?: string }) {
  return input.direction === 'incoming' && targetsInboundApplication(input);
}

export function isInboundCallAnswered(input: InboundRouteInput & { hasOutboundPair: boolean }) {
  return !input.hasOutboundPair && targetsInboundApplication(input);
}

type ParkedClientCallInput = {
  connectionId?: string;
  credentialConnectionId: string;
  direction?: string;
  flow?: string;
  flowDestination?: string;
  state?: string;
};

export function isParkedClientCall(input: ParkedClientCallInput) {
  return sameValue(input.connectionId, input.credentialConnectionId)
    && input.direction === 'outgoing'
    && ['outbound', 'internal'].includes(input.flow || '')
    && (input.flowDestination === 'ob_park' || input.state === 'parked');
}

type HangupInput = {
  hangupCause?: string;
  telnyxError?: {
    error_code?: string;
  };
};

export function voiceRouteHangupOutcome(input: HangupInput): {
  phase: 'ended' | 'failed';
  failureCause?: string;
} {
  const errorCode = String(input.telnyxError?.error_code || '').trim().toUpperCase();
  if (errorCode === 'D17') return { phase: 'failed', failureCause: 'platform_calling_unavailable' };
  if (errorCode) return { phase: 'failed', failureCause: `carrier_${errorCode.toLowerCase().replace(/[^a-z0-9_-]/g, '')}` };

  const cause = String(input.hangupCause || '').trim().toLowerCase();
  if (cause === 'normal_clearing' || cause === 'originator_cancel') {
    return { phase: 'ended', failureCause: cause };
  }
  return { phase: 'failed', failureCause: cause.replace(/[^a-z0-9_-]/g, '_') || 'call_failed' };
}

export function resolveParkedReservation<T extends { routeId: string }, R extends { routeId: string; phase: string }>(input: {
  routeId: string;
  signedReservation: T | null;
  storedRoute: R | null;
}): { reservation: T | R | null; reason: string } {
  if (input.storedRoute && ['ended', 'failed'].includes(input.storedRoute.phase)) {
    return { reservation: null, reason: 'route_canceled' };
  }
  const signed = input.signedReservation?.routeId === input.routeId ? input.signedReservation : null;
  const reservation = signed || input.storedRoute;
  return { reservation: reservation || null, reason: reservation ? '' : 'missing_reservation' };
}

export function ivrMenuSelection(input: { digits?: string; result?: string; status?: string }, departmentCount: number) {
  const status = String(input.status || '').toLowerCase();
  if (['timeout', 'invalid', 'cancelled', 'canceled'].includes(status)) return null;
  const raw = String(input.digits ?? input.result ?? '').trim();
  if (!/^[1-9]$/.test(raw)) return null;
  const digit = Number(raw);
  return digit >= 1 && digit <= departmentCount ? digit : null;
}
