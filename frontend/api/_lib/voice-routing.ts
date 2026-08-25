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
