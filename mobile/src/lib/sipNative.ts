import { NativeModules, Platform } from 'react-native';

type VocivoSipModule = {
  register(config: {
    username: string;
    password: string;
    domain: string;
    wsUri?: string;
    displayName?: string;
  }): Promise<void>;
  unregister(): Promise<void>;
  invite(target: string, headers?: Array<{ name: string; value: string }>): Promise<string>;
  hangup(callId?: string): Promise<void>;
};

export function vocivoSipModule(): VocivoSipModule | null {
  const native = NativeModules.VocivoSip as VocivoSipModule | undefined;
  return native || null;
}

export async function registerVocivoSip(config: Parameters<VocivoSipModule['register']>[0]) {
  const native = vocivoSipModule();
  if (!native) {
    throw new Error(Platform.OS === 'ios'
      ? 'Vocivo SIP CallKit is not linked in this build. Telnyx remains the voice client.'
      : 'Vocivo SIP is not available on this platform.');
  }
  await native.register(config);
}
