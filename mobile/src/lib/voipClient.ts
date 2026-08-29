import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTelnyxVoipClient, VoicePnBridge } from '@telnyx/react-voice-commons-sdk';
import { NativeModules, Platform } from 'react-native';

export { VoicePnBridge };

export const voipClient = createTelnyxVoipClient({
  enableAppStateManagement: true,
  debug: __DEV__,
  useTrickleIce: true,
});

export async function getVoicePushToken() {
  if (Platform.OS === 'ios') return (await VoicePnBridge.getVoipToken())?.trim() || undefined;
  return (await VoicePnBridge.getFirebaseToken())?.trim() || undefined;
}

const telnyxStorageKeys = [
  '@telnyx_username',
  '@telnyx_password',
  '@credential_token',
  '@push_token',
  '@push_when_active',
  '@use_trickle_ice',
  '@ice_servers',
  '@enable_missed_call_notifications',
];

export async function signOutVoiceDevice() {
  await setVoiceSignedIn(false);
  try {
    voipClient.disablePushNotifications();
    // Let the SDK send the unregister command before closing its socket.
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch {
    // Local credentials are still removed below so auto-reconnect cannot revive the session.
  }
  await AsyncStorage.multiRemove(telnyxStorageKeys);
  await voipClient.logout().catch(() => undefined);
}

export async function setVoiceSignedIn(signedIn: boolean) {
  await AsyncStorage.setItem('@vocivo_voice_signed_in', signedIn ? '1' : '0');
  const bridge = NativeModules.VoicePnBridge as { setVocivoVoiceSignedIn?: (value: boolean) => Promise<boolean> } | undefined;
  if (bridge?.setVocivoVoiceSignedIn) await bridge.setVocivoVoiceSignedIn(signedIn);
}
