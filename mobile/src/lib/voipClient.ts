import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTelnyxVoipClient } from '@telnyx/react-voice-commons-sdk';

export const voipClient = createTelnyxVoipClient({
  enableAppStateManagement: true,
  debug: __DEV__,
  useTrickleIce: true,
});

const telnyxStorageKeys = [
  '@telnyx_username',
  '@telnyx_password',
  '@credential_token',
  '@push_token',
  '@push_when_active',
  '@use_trickle_ice',
  '@enable_missed_call_notifications',
];

export async function signOutVoiceDevice() {
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
