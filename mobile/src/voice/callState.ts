import { TelnyxCallState, type Call } from '@telnyx/react-voice-commons-sdk';
import type { CallLifecycleState } from '../lib/callLifecycle';
import type { CallPhase } from '../types';

export function toCallPhase(state: TelnyxCallState): CallPhase {
  if (state === TelnyxCallState.RINGING) return 'ringing';
  if (state === TelnyxCallState.CONNECTING) return 'connecting';
  if (state === TelnyxCallState.ACTIVE || state === TelnyxCallState.HELD) return 'active';
  if (state === TelnyxCallState.DROPPED) return 'connecting';
  if (state === TelnyxCallState.FAILED) return 'failed';
  return 'ended';
}

export function toLifecycleState(state: TelnyxCallState): CallLifecycleState {
  if (state === TelnyxCallState.CONNECTING) return 'CONNECTING';
  if (state === TelnyxCallState.RINGING) return 'RINGING';
  if (state === TelnyxCallState.ACTIVE) return 'ACTIVE';
  if (state === TelnyxCallState.HELD) return 'HELD';
  if (state === TelnyxCallState.FAILED) return 'FAILED';
  if (state === TelnyxCallState.DROPPED) return 'DROPPED';
  return 'ENDED';
}

export function waitForCallState(call: Call, expected: TelnyxCallState, timeoutMs = 6_000) {
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
      else if ([TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(state)) {
        queueMicrotask(() => finish(new Error(`The call ended before reaching ${expected}.`)));
      }
    });
    timer = setTimeout(() => finish(new Error(`The call did not reach ${expected} within ${timeoutMs}ms.`)), timeoutMs);
  });
}
