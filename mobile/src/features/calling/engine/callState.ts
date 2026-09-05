import { CallState, isTerminalVoiceCallState, type VoiceCall, type VoiceCallState } from './voiceEngine';
import type { CallLifecycleState } from '../state/callLifecycle';
import type { CallPhase } from '../../../shared/types';

export function toCallPhase(state: VoiceCallState): CallPhase {
  if (state === CallState.RINGING) return 'ringing';
  if (state === CallState.CONNECTING) return 'connecting';
  if (state === CallState.ACTIVE || state === CallState.HELD) return 'active';
  if (state === CallState.DROPPED) return 'connecting';
  if (state === CallState.FAILED) return 'failed';
  return 'ended';
}

export function toUiCallPhase(state: VoiceCallState, connectedAt?: number): CallPhase {
  if (state === CallState.ACTIVE && !connectedAt) return 'connecting';
  return toCallPhase(state);
}

export function toLifecycleState(state: VoiceCallState): CallLifecycleState {
  if (state === CallState.CONNECTING) return 'CONNECTING';
  if (state === CallState.RINGING) return 'RINGING';
  if (state === CallState.ACTIVE) return 'ACTIVE';
  if (state === CallState.HELD) return 'HELD';
  if (state === CallState.FAILED) return 'FAILED';
  if (state === CallState.DROPPED) return 'DROPPED';
  return 'ENDED';
}

export function waitForCallState(call: VoiceCall, expected: VoiceCallState, timeoutMs = 6_000) {
  if (call.currentState === expected) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscription: { unsubscribe: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (failure?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      subscription?.unsubscribe();
      if (failure) reject(failure);
      else resolve();
    };
    subscription = call.callState$.subscribe((state) => {
      if (state === expected) queueMicrotask(() => finish());
      else if (isTerminalVoiceCallState(state)) {
        queueMicrotask(() => finish(new Error(`The call ended before reaching ${expected}.`)));
      }
    });
    timer = setTimeout(() => finish(new Error(`The call did not reach ${expected} within ${timeoutMs}ms.`)), timeoutMs);
  });
}
