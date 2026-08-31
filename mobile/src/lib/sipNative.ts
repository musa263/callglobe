import { NativeModules } from 'react-native';
import { startSipUserAgent, stopSipUserAgent } from './sipJsClient';

type VocivoSipModule = {
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
};

export function vocivoSipModule(): VocivoSipModule | null {
  const native = NativeModules.VocivoSip as VocivoSipModule | undefined;
  return native || null;
}

export async function registerVocivoSip(config: Parameters<VocivoSipModule['register']>[0]) {
  const native = vocivoSipModule();
  if (native) {
    await native.register(config);
    return;
  }
  await startSipUserAgent(config);
}

export async function unregisterVocivoSip() {
  const native = vocivoSipModule();
  if (native) {
    await native.unregister();
    return;
  }
  await stopSipUserAgent();
}
