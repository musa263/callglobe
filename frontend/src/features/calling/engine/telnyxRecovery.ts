export const TELNYX_ROUTE_SETUP_MS = 60_000;
export const TELNYX_ROUTE_POLL_MS = 1_000;

/** Dispose local RTP independently of whether signaling can send a BYE. */
export function disposeTelnyxCall(call: any, report: (operation: string, error: unknown) => void) {
  const peer = call?.peer?.instance;
  for (const track of new Set<any>([
    ...(peer?.getSenders?.() || []).map((sender: any) => sender.track),
    ...(peer?.getReceivers?.() || []).map((receiver: any) => receiver.track),
    ...(call?.localStream?.getTracks?.() || []),
    ...(call?.remoteStream?.getTracks?.() || []),
  ].filter(Boolean))) {
    try { track.stop(); } catch (error) { report('stop Telnyx media track', error); }
  }
  try { peer?.close?.(); } catch (error) { report('close Telnyx peer connection', error); }
  try { Promise.resolve(call?.hangup?.()).catch(error => report('hang up Telnyx call', error)); }
  catch (error) { report('hang up Telnyx call', error); }
}

export function voiceRetryDelay(attempt: number) {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
}
