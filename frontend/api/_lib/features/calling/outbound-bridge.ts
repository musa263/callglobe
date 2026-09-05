import { TelnyxApiError } from '../../shared/telnyx.js';
import { callAction } from './voice-control.js';

type BridgeAction = typeof callAction;

function retryable(error: unknown) {
  return error instanceof TelnyxApiError
    && ([404, 409, 422, 429].includes(error.status) || error.status >= 500);
}

function alreadyAnswered(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already answered|call has already been answered|not in a parked/i.test(message);
}

function alreadyBridged(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already bridged|call is already bridged|prevent_double_bridge/i.test(message);
}

export async function prepareParkedCallerMedia(
  clientCallControlId: string,
  eventId: string,
  action: BridgeAction = callAction,
) {
  try {
    await action(clientCallControlId, 'answer', { command_id: `${eventId}-answer-parked` });
  } catch (error) {
    if (!alreadyAnswered(error) && !alreadyBridged(error)) throw error;
  }
  await action(clientCallControlId, 'playback_stop', {
    stop: 'all',
    command_id: `${eventId}-stop-ringback`,
  }).catch(() => undefined);
}

export async function answerParkedCallerThenBridge(
  clientCallControlId: string,
  destinationCallControlId: string,
  eventId: string,
  action: BridgeAction = callAction,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  await prepareParkedCallerMedia(clientCallControlId, eventId, action);
  await bridgeOutboundCalls(clientCallControlId, destinationCallControlId, eventId, action, wait);
}

export async function bridgeOutboundCalls(
  clientCallControlId: string,
  destinationCallControlId: string,
  eventId: string,
  action: BridgeAction = callAction,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const delays = [0, 250, 650];

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await wait(delays[attempt]);
    try {
      await action(clientCallControlId, 'bridge', {
        call_control_id: destinationCallControlId,
        prevent_double_bridge: true,
        command_id: `${eventId}-bridge-${attempt + 1}`,
      });
      return;
    } catch (error) {
      if (alreadyBridged(error)) return;
      // The final attempt always rethrows here, so the loop is the only exit.
      if (!retryable(error) || attempt === delays.length - 1) throw error;
    }
  }
}
