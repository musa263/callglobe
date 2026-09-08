import { VoicePnBridge, voipClient } from '../runtime/voipClient';
import { createSipVoiceClient, endVocivoSipCallUi, toggleVocivoSipSpeaker } from '../runtime/sipNative';
import type { PlatformCallUi, VoiceEngineName } from './voiceClientFacade';
import type { VoiceClient } from './voiceEngine';

/**
 * The two engines that can carry a call, behind one shape.
 *
 * `VoiceCallState` and `VoiceConnectionState` were deliberately given the same
 * string values as the carrier SDK's own enums, which is what makes the cast
 * below sound rather than hopeful: the two vocabularies are identical, and the
 * surface `VoiceClient` names is a subset of what the SDK client offers.
 */

export type Engine = {
  name: VoiceEngineName;
  client: VoiceClient;
  platform: PlatformCallUi;
};

/** The carrier SDK. Still the engine for any tenant not yet on the SIP edge. */
export function telnyxEngine(): Engine {
  return {
    name: 'telnyx',
    client: voipClient as unknown as VoiceClient,
    platform: {
      toggleSpeaker: () => VoicePnBridge.toggleSpeaker(),
      // The SDK's bridge reports success; the facade only needs it done.
      endNativeCall: async (callId) => { await VoicePnBridge.endCall(callId); },
      hideIncomingCallUi: async () => { await VoicePnBridge.hideIncomingCallNotification(); },
    },
  };
}

/**
 * Vocivo's platform SIP edge: tenant-scoped calls over its Kamailio/RTPEngine,
 * with CallKit and ConnectionService from Vocivo's native module.
 */
export function sipEngine(): Engine {
  return {
    name: 'sip',
    client: createSipVoiceClient(),
    platform: {
      toggleSpeaker: () => toggleVocivoSipSpeaker(),
      endNativeCall: (callId) => endVocivoSipCallUi(callId),
      // CallKit and ConnectionService take the call off screen themselves when
      // the engine reports it connected; there is no separate notification.
      hideIncomingCallUi: async () => undefined,
    },
  };
}
