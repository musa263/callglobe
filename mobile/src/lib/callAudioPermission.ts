export type MicrophonePermissionApi = {
  getRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
  requestRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
};

export function deniedMicrophoneMessage() {
  return 'Microphone access is required for calls. Allow Microphone for Vocivo in iPhone Settings, then try again.';
}

export async function ensureCallMicrophonePermission(api?: MicrophonePermissionApi) {
  const permissions = api ?? await loadExpoAudioPermissions();
  const current = await permissions.getRecordingPermissionsAsync();
  if (current.granted) return;
  const next = await permissions.requestRecordingPermissionsAsync();
  if (!next.granted) throw new Error(deniedMicrophoneMessage());
}

async function loadExpoAudioPermissions(): Promise<MicrophonePermissionApi> {
  const audio = await import('expo-audio');
  return {
    getRecordingPermissionsAsync: audio.getRecordingPermissionsAsync,
    requestRecordingPermissionsAsync: audio.requestRecordingPermissionsAsync,
  };
}
