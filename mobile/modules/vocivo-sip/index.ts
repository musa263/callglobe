import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type VocivoSipNative = {
  register(config: {
    username: string;
    password: string;
    domain: string;
    wsUri?: string;
    displayName?: string;
    iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  }): Promise<void>;
  unregister(): Promise<void>;
  invite(target: string, headers?: Array<{ name: string; value: string }>): Promise<string>;
  hangup(callId?: string): Promise<void>;
  answer(callId?: string): Promise<void>;
};

export function getVocivoSipNative(): VocivoSipNative | null {
  if (Platform.OS === 'web') return null;
  return requireOptionalNativeModule<VocivoSipNative>('VocivoSip');
}
