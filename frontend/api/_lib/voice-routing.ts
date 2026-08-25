type InboundRouteInput = {
  connectionId?: string;
  callControlApplicationId: string;
  to?: string;
  inboundNumber: string;
  hasManagedState: boolean;
};

function sameValue(value: string | undefined, expected: string) {
  return String(value || '').trim() === expected.trim();
}

function targetsInboundNumber(input: InboundRouteInput) {
  return sameValue(input.connectionId, input.callControlApplicationId)
    && sameValue(input.to, input.inboundNumber)
    && !input.hasManagedState;
}

export function isInboundCallInitiated(input: InboundRouteInput & { direction?: string }) {
  return input.direction === 'incoming' && targetsInboundNumber(input);
}

export function isInboundCallAnswered(input: InboundRouteInput & { hasOutboundPair: boolean }) {
  return !input.hasOutboundPair && targetsInboundNumber(input);
}
