import { callAction } from './voice-control.js';
import { TelnyxApiError } from './telnyx.js';
import {
  clearOutboundCallPair,
  liveOutboundDestinationId,
  readOutboundCallPairByClient,
  updateOutboundCallPair,
  type OutboundCallPair,
  type OutboundTerminationState,
} from './outbound-call-store.js';

export function outboundCallControlIds(pair: OutboundCallPair) {
  return [...new Set([
    pair.clientCallControlId,
    liveOutboundDestinationId(pair),
    pair.destinationCallControlId,
    ...(pair.forkDestinationCallControlIds || []),
    pair.peerClientCallControlId,
    pair.peerDestinationCallControlId,
  ].filter((id): id is string => Boolean(id)))];
}

export function conferenceParticipantTeardown(pair: OutboundCallPair, hangingCallControlId: string) {
  const hangIds = [hangingCallControlId];
  if (pair.status === 'merging') {
    hangIds.push(pair.clientCallControlId, pair.destinationCallControlId, ...(pair.forkDestinationCallControlIds || []));
    return { hangIds: [...new Set(hangIds.filter(Boolean))], keepPair: null as OutboundCallPair | null, peerAction: 'unlink' as const };
  }
  const hangingRemote = hangingCallControlId === liveOutboundDestinationId(pair) || hangingCallControlId === pair.destinationCallControlId;
  if (pair.conferenceRole === 'host' && hangingCallControlId === pair.peerDestinationCallControlId) {
    return {
      hangIds: [...new Set(hangIds.filter(Boolean))],
      keepPair: {
        ...pair,
        peerClientCallControlId: undefined,
        peerDestinationCallControlId: undefined,
      },
      peerAction: 'clear' as const,
    };
  }
  if (pair.conferenceRole === 'host' && hangingRemote) {
    const nextDest = pair.peerDestinationCallControlId && pair.peerDestinationCallControlId !== hangingCallControlId
      ? pair.peerDestinationCallControlId
      : '';
    if (!nextDest) {
      hangIds.push(pair.clientCallControlId);
      return { hangIds: [...new Set(hangIds.filter(Boolean))], keepPair: null as OutboundCallPair | null, peerAction: 'clear' as const };
    }
    return {
      hangIds: [...new Set(hangIds.filter(Boolean))],
      keepPair: {
        ...pair,
        destinationCallControlId: nextDest,
        selectedDestinationCallControlId: nextDest,
        peerClientCallControlId: undefined,
        peerDestinationCallControlId: undefined,
        forkDestinationCallControlIds: [],
      },
      peerAction: 'clear' as const,
    };
  }
  return { hangIds: [...new Set(hangIds.filter(Boolean))], keepPair: null as OutboundCallPair | null, peerAction: 'unlink' as const };
}

function errorText(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : 'Unknown Telnyx hangup failure';
}

export function shouldClaimTermination(state: OutboundTerminationState | undefined, now = Date.now()) {
  if (state?.status === 'terminated') return false;
  if (state?.status !== 'pending') return true;
  const updatedAt = new Date(state.updatedAt).getTime();
  return !Number.isFinite(updatedAt) || now - updatedAt >= 15_000;
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
  const claimedIds = new Set<string>();
  const pendingPair = await updateOutboundCallPair(pair, (current) => {
    claimedIds.clear();
    const termination = { ...(current.termination || {}) };
    for (const id of uniqueIds) {
      const previous = termination[id];
      if (!shouldClaimTermination(previous)) continue;
      claimedIds.add(id);
      termination[id] = {
        status: 'pending',
        attempts: previous?.attempts || 0,
        updatedAt: pendingAt,
      };
    }
    return { ...current, termination, updatedAt: pendingAt };
  });
  // The transaction above is the single-flight claim. Concurrent hangup,
  // cancel, and webhook handlers must not all send the same carrier commands.
  const actionableIds = [...claimedIds];
  if (!actionableIds.length) return pendingPair;
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

export async function hangupConferenceParticipant(pair: OutboundCallPair, hangingCallControlId: string, commandPrefix: string) {
  const plan = conferenceParticipantTeardown(pair, hangingCallControlId);
  await terminateOutboundLegs(pair, plan.hangIds, commandPrefix);
  if (pair.peerClientCallControlId) {
    const peer = await readOutboundCallPairByClient(pair.peerClientCallControlId);
    if (peer) {
      if (plan.peerAction === 'clear') await clearOutboundCallPair(peer);
      else {
        await updateOutboundCallPair(peer, (current) => ({
          ...current,
          status: current.status === 'merging' ? 'direct' : current.status,
          conferenceId: current.status === 'merging' ? undefined : current.conferenceId,
          conferenceRole: current.status === 'merging' ? undefined : current.conferenceRole,
          peerClientCallControlId: undefined,
          peerDestinationCallControlId: undefined,
          updatedAt: new Date().toISOString(),
        }));
      }
    }
  }
  if (plan.keepPair) {
    await updateOutboundCallPair(pair, (current) => ({
      ...plan.keepPair!,
      termination: current.termination,
      updatedAt: new Date().toISOString(),
    }));
  } else {
    await clearOutboundCallPair(pair);
  }
}

export async function terminateOutboundPair(pair: OutboundCallPair, commandPrefix: string) {
  const ids = outboundCallControlIds(pair);
  // Hanging up a Call Control leg stops its playback. Sending playback_stop as
  // a separate command doubled carrier traffic and made concurrent cancel
  // webhooks wait on already-ended calls.
  const updated = await terminateOutboundLegs(pair, ids, commandPrefix);
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
