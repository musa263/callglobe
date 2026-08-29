import { callAction } from './voice-control.js';
import { TelnyxApiError } from './telnyx.js';
import {
  clearOutboundCallPair,
  updateOutboundCallPair,
  type OutboundCallPair,
  type OutboundTerminationState,
} from './outbound-call-store.js';

export function outboundCallControlIds(pair: OutboundCallPair) {
  return [...new Set([
    pair.clientCallControlId,
    pair.destinationCallControlId,
    ...(pair.forkDestinationCallControlIds || []),
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

function errorText(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : 'Unknown Telnyx hangup failure';
}

export function isAlreadyTerminatedHangupError(error: unknown) {
  return error instanceof TelnyxApiError
    && (error.status === 404 || (error.status === 422 && /no longer active|can't receive commands|already (?:ended|terminated)/i.test(error.message)));
}

export function isRetryableHangupError(error: unknown) {
  return !(error instanceof TelnyxApiError) || error.status === 409 || error.status === 422 || error.status === 429 || error.status >= 500;
}

async function hangupLeg(id: string, commandId: string, priorAttempts = 0): Promise<OutboundTerminationState> {
  const delays = [0, 200, 600];
  let lastError: unknown;
  let attempts = 0;
  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index]) await new Promise((resolve) => setTimeout(resolve, delays[index]));
    attempts += 1;
    try {
      await callAction(id, 'hangup', { command_id: commandId });
      return { status: 'terminated', attempts: priorAttempts + attempts, updatedAt: new Date().toISOString() };
    } catch (error) {
      if (isAlreadyTerminatedHangupError(error)) {
        return { status: 'terminated', attempts: priorAttempts + attempts, updatedAt: new Date().toISOString() };
      }
      lastError = error;
      if (!isRetryableHangupError(error)) break;
    }
  }
  return {
    status: isRetryableHangupError(lastError) ? 'retryable_failed' : 'permanent_failed',
    attempts: priorAttempts + attempts,
    lastError: errorText(lastError),
    updatedAt: new Date().toISOString(),
  };
}

export async function terminateOutboundLegs(pair: OutboundCallPair, ids: string[], commandPrefix: string) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const pendingAt = new Date().toISOString();
  const pendingPair = await updateOutboundCallPair(pair, (current) => ({
    ...current,
    termination: {
      ...(current.termination || {}),
      ...Object.fromEntries(uniqueIds
        .filter((id) => current.termination?.[id]?.status !== 'terminated')
        .map((id) => [id, {
          status: 'pending' as const,
          attempts: current.termination?.[id]?.attempts || 0,
          updatedAt: pendingAt,
        }])),
    },
    updatedAt: pendingAt,
  }));
  const actionableIds = uniqueIds.filter((id) => pendingPair.termination?.[id]?.status !== 'terminated');
  const results = await Promise.all(actionableIds.map(async (id) => [
    id,
    await hangupLeg(id, `${commandPrefix}-end-${id.slice(-8)}`, pendingPair.termination?.[id]?.attempts || 0),
  ] as const));
  return updateOutboundCallPair(pendingPair, (current) => ({
    ...current,
    termination: { ...(current.termination || {}), ...Object.fromEntries(results) },
    updatedAt: new Date().toISOString(),
  }));
}

export async function terminateOutboundPair(pair: OutboundCallPair, commandPrefix: string) {
  const ids = outboundCallControlIds(pair);
  const playbackIds = outboundPlaybackCallControlIds(pair);
  const playbackCleanup = Promise.all(playbackIds.map(async (id) => {
    try {
      await callAction(id, 'playback_stop', { stop: 'all', command_id: `${commandPrefix}-stop-${id.slice(-8)}` });
    } catch (error) {
      console.warn('[outbound-cancel] ringback stop failed before hangup', { callControlId: id, error: errorText(error) });
    }
  }));
  // Never make the opposite party wait for playback cleanup before receiving
  // the hangup. Both operations are independent and must start together.
  const [updated] = await Promise.all([
    terminateOutboundLegs(pair, ids, commandPrefix),
    playbackCleanup,
  ]);
  const complete = ids.every((id) => updated.termination?.[id]?.status === 'terminated');
  if (complete) {
    await clearOutboundCallPair(updated);
  } else {
    console.error('[outbound-cancel] retained call pair for idempotent hangup retry', {
      routeId: updated.routeId,
      clientCallControlId: updated.clientCallControlId,
      termination: updated.termination,
    });
  }
  return { complete, pair: updated };
}
