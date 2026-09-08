export type VoiceEdge = 'telnyx' | 'sip';

export type VoiceEdgeConfig = {
  voice_edge?: string;
  provider?: string;
  sip_ws_uri?: string;
  sip_domain?: string;
  sip_credentials_endpoint?: string;
};

export function voiceEdgeFromConfig(config?: VoiceEdgeConfig | null): VoiceEdge {
  const selected = config?.voice_edge ?? config?.provider;
  if (selected !== 'sip' && selected !== 'telnyx') throw new Error('The calling engine configuration is unavailable.');
  return selected;
}

export function sipNativeAvailable(nativeModules: { VocivoSip?: unknown } | null | undefined) {
  return Boolean(nativeModules?.VocivoSip);
}

export function shouldUseSipNative(edge: VoiceEdge, nativeModules: { VocivoSip?: unknown } | null | undefined) {
  return edge === 'sip' && sipNativeAvailable(nativeModules);
}
