import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createTelnyxVoipClient, VoicePnBridge } from '@telnyx/react-voice-commons-sdk';
import { NativeModules, Platform } from 'react-native';

export { VoicePnBridge };

export const voipClient = createTelnyxVoipClient({
  enableAppStateManagement: true,
  debug: __DEV__,
  useTrickleIce: true,
});

const secureVoiceSessionKey = 'vocivo.secure.voice-session.v1';

export async function getVoicePushToken() {
  if (Platform.OS === 'ios') return (await VoicePnBridge.getVoipToken())?.trim() || undefined;
  return (await VoicePnBridge.getFirebaseToken())?.trim() || undefined;
}

export async function persistVoiceSession(session: {
  token: string;
  expiresAt?: number;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}) {
  await SecureStore.setItemAsync(secureVoiceSessionKey, JSON.stringify({
    token: session.token,
    expiresAt: session.expiresAt || 0,
    iceServers: session.iceServers || [],
  }), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  // Remove legacy plaintext copies immediately after successful migration.
  await AsyncStorage.multiRemove(['@credential_token', '@credential_token_expires_at', '@ice_servers']);
}

export async function loadVoiceSession() {
  try {
    const raw = await SecureStore.getItemAsync(secureVoiceSessionKey);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { token?: string; expiresAt?: number; iceServers?: unknown };
    const token = stored.token?.trim();
    const expiresAt = Number(stored.expiresAt || 0);
    if (!token || !Number.isFinite(expiresAt)) return null;
    const parsed = stored.iceServers;
    return {
      token,
      expiresAt,
      iceServers: Array.isArray(parsed) && parsed.length ? parsed : undefined,
    };
  } catch (failure) {
    const normalized = failure instanceof Error ? failure : new Error(String(failure));
    console.error('[Vocivo Voice] stored ICE configuration is invalid', { message: normalized.message, stack: normalized.stack });
    return null;
  }
}

const telnyxStorageKeys = [
  '@telnyx_username',
  '@telnyx_password',
  '@credential_token',
  '@credential_token_expires_at',
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
  } catch (failure) {
    const normalized = failure instanceof Error ? failure : new Error(String(failure));
    console.error('[Vocivo Voice] failed to unregister push notifications', { message: normalized.message, stack: normalized.stack });
  }
  await AsyncStorage.multiRemove(telnyxStorageKeys);
  await SecureStore.deleteItemAsync(secureVoiceSessionKey);
  await voipClient.logout();
}

export async function setVoiceSignedIn(signedIn: boolean) {
  await AsyncStorage.setItem('@vocivo_voice_signed_in', signedIn ? '1' : '0');
  const bridge = NativeModules.VoicePnBridge as { setVocivoVoiceSignedIn?: (value: boolean) => Promise<boolean> } | undefined;
  if (!bridge?.setVocivoVoiceSignedIn) throw new Error('The native voice authentication bridge is unavailable.');
  const updated = await bridge.setVocivoVoiceSignedIn(signedIn);
  if (updated !== true) throw new Error('The native voice authentication bridge rejected the state change.');
}
