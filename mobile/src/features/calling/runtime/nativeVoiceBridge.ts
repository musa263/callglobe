import { NativeModules, Platform } from 'react-native';

// Shared identity and push controls belong to Vocivo. Native carrier call UI
// and Android ringtone methods remain compatibility-only in this migration slice.
type VocivoControls = {
  voipPushToken(): Promise<string | null>;
  firebasePushToken(): Promise<string | null>;
  setVoiceSignedIn(value: boolean): Promise<boolean>;
};
function vocivo(): VocivoControls {
  const native = NativeModules.VocivoSip as VocivoControls | undefined;
  if (!native?.setVoiceSignedIn) throw new Error('Install the latest Vocivo build to enable native calling controls.');
  return native;
}
export const setNativeVoiceSignedIn = (value: boolean) => vocivo().setVoiceSignedIn(value);

type Bridge = {
  getVoipToken(): Promise<string | null>;
  getFirebaseToken(): Promise<string | null>;
  setIncomingCallRingtone(value: string): Promise<boolean>;
  isSpeakerEnabled(): Promise<boolean>;
  setSpeakerEnabled(value: boolean): Promise<boolean>;
  endCall(id: string): Promise<boolean>;
  hideIncomingCallNotification(): Promise<boolean>;
  setVocivoVoiceSignedIn(value: boolean): Promise<boolean>;
};
function bridge(): Bridge {
  if (!NativeModules.VoicePnBridge) throw new Error('Native calling controls are unavailable in this build.');
  return NativeModules.VoicePnBridge as Bridge;
}

export const VoicePnBridge = {
  getVoipToken: async () => Platform.OS === 'ios' ? vocivo().voipPushToken() : null,
  getFirebaseToken: async () => Platform.OS === 'android' ? vocivo().firebasePushToken() : null,
  clearManagedSession: () => bridge().setVocivoVoiceSignedIn(false),
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
