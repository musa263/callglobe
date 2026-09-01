export type VoiceEdge = 'telnyx' | 'sip';

export type VoiceEdgeConfig = {
  voice_edge?: string;
  provider?: string;
  sip_ws_uri?: string;
  sip_domain?: string;
  sip_credentials_endpoint?: string;
};

export function voiceEdgeFromConfig(config?: VoiceEdgeConfig | null): VoiceEdge {
  return config?.voice_edge === 'sip' || config?.provider === 'sip' ? 'sip' : 'telnyx';
}

export function sipNativeAvailable(nativeModules: { VocivoSip?: unknown } | null | undefined) {
  return Boolean(nativeModules?.VocivoSip);
}

/** SIP-edge phones must REGISTER on Vocivo SIP even when NativeModules.VocivoSip is empty (Expo loads it via requireOptionalNativeModule). */
export function shouldRegisterSipEdge(edge: VoiceEdge) {
  return edge === 'sip';
}

export function shouldUseSipNative(
  edge: VoiceEdge,
  nativeModules: { VocivoSip?: unknown } | null | undefined,
  platform: string = typeof navigator === 'undefined' ? 'ios' : 'web',
) {
  return shouldRegisterSipEdge(edge) && platform === 'ios' && sipNativeAvailable(nativeModules);
}
