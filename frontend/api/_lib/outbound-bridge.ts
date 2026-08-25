import { TelnyxApiError } from './telnyx.js';
import { callAction } from './voice-control.js';

type BridgeAction = typeof callAction;

function retryable(error: unknown) {
  return error instanceof TelnyxApiError
    && ([404, 409, 422, 429].includes(error.status) || error.status >= 500);
}

export async function bridgeOutboundCalls(
  clientCallControlId: string,
  destinationCallControlId: string,
  eventId: string,
  action: BridgeAction = callAction,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const delays = [0, 250, 650];
  let lastError: unknown;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await wait(delays[attempt]);
    try {
      await action(clientCallControlId, 'bridge', {
        call_control_id: destinationCallControlId,
        command_id: `${eventId}-bridge-${attempt + 1}`,
      });
      return;
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === delays.length - 1) throw error;
    }
  }

  throw lastError;
}
