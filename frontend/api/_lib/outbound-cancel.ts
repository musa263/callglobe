import { callAction } from './voice-control.js';
import { clearOutboundCallPair, type OutboundCallPair } from './outbound-call-store.js';

export function outboundCallControlIds(pair: OutboundCallPair) {
  return [...new Set([
    pair.clientCallControlId,
    pair.destinationCallControlId,
    pair.peerClientCallControlId,
    pair.peerDestinationCallControlId,
  ].filter((id): id is string => Boolean(id)))];
}

export function outboundPlaybackCallControlIds(pair: OutboundCallPair) {
  return [...new Set([
    pair.clientCallControlId,
    pair.peerClientCallControlId,
  ].filter((id): id is string => Boolean(id)))];
}

export async function terminateOutboundPair(pair: OutboundCallPair, commandPrefix: string) {
  const ids = outboundCallControlIds(pair);
  const playbackIds = outboundPlaybackCallControlIds(pair);
  await Promise.all(playbackIds.map((id) => callAction(id, 'playback_stop', {
    stop: 'all',
    command_id: `${commandPrefix}-stop-${id.slice(-8)}`,
  }).catch(() => undefined)));
  await Promise.all(ids.map(async (id) => {
    await callAction(id, 'hangup', {
      command_id: `${commandPrefix}-end-${id.slice(-8)}`,
    }).catch(() => undefined);
  }));
  await clearOutboundCallPair(pair).catch(() => undefined);
}
