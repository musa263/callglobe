export function outboundUsesNativeBridgeOnAnswer(
  pair?: { bridgeOnAnswer?: boolean } | null,
  state?: { flow?: string; bridgeOnAnswer?: boolean } | null,
) {
  return pair?.bridgeOnAnswer === true
    || (state?.flow === 'outbound_destination' && state.bridgeOnAnswer === true);
}
