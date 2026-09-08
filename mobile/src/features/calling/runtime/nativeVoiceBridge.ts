import { NativeModules, Platform } from 'react-native';

// Compatibility with installed native builds. This does not load the managed JS
// SDK. These remaining native methods move into VocivoSip in the next native release.
type Bridge = {
  getVoipToken(): Promise<string | null>;
  getFirebaseToken(): Promise<string | null>;
  setIncomingCallRingtone(value: string): Promise<boolean>;
  isSpeakerEnabled(): Promise<boolean>;
  setSpeakerEnabled(value: boolean): Promise<boolean>;
  endCall(id: string): Promise<boolean>;
  hideIncomingCallNotification(): Promise<boolean>;
};
function bridge(): Bridge {
  if (!NativeModules.VoicePnBridge) throw new Error('Native calling controls are unavailable in this build.');
  return NativeModules.VoicePnBridge as Bridge;
}

export const VoicePnBridge = {
  getVoipToken: async () => Platform.OS === 'ios' ? bridge().getVoipToken() : null,
  getFirebaseToken: async () => Platform.OS === 'android' ? bridge().getFirebaseToken() : null,
  // Preserve the installed SDK's Android-only contract. The iOS implementation
  // initializes the managed CallKit manager and must not run on SIP startup.
  setIncomingCallRingtone: async (value: string) => Platform.OS === 'android'
    ? bridge().setIncomingCallRingtone(value) : true,
  endCall: (id: string) => bridge().endCall(id),
  hideIncomingCallNotification: () => bridge().hideIncomingCallNotification(),
  toggleSpeaker: async () => {
    const native = bridge();
    const desired = !await native.isSpeakerEnabled();
    return native.setSpeakerEnabled(desired);
  },
};
