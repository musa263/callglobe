import type { PbxConfig } from './pbx-config-store.js';

export type VoiceProvider = 'telnyx';

export type VoiceIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

function trimmedEnv(name: string) {
  return process.env[name]?.trim() || '';
}

export function voiceProvider(_config: PbxConfig): VoiceProvider {
  return 'telnyx';
}

function validIceUrl(value: unknown): value is string {
  return typeof value === 'string' && /^(?:stun|turn|turns):[^\s]+$/i.test(value);
}

export function voiceIceServers(_subject = 'voice-session'): VoiceIceServer[] {
  const configured = trimmedEnv('TELNYX_ICE_SERVERS_JSON');
  if (!configured) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch {
    throw new Error('TELNYX_ICE_SERVERS_JSON must contain valid JSON.');
  }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('TELNYX_ICE_SERVERS_JSON must contain at least one ICE server.');
  return parsed.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('TELNYX_ICE_SERVERS_JSON contains an invalid ICE server.');
    const value = candidate as VoiceIceServer;
    const urls = Array.isArray(value.urls) ? value.urls.filter(validIceUrl) : validIceUrl(value.urls) ? value.urls : [];
    if (!urls.length) throw new Error('Every Telnyx ICE server requires a STUN, TURN, or TURNS URL.');
    const requiresCredential = (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:/i.test(url));
    if (requiresCredential && (!value.username || !value.credential)) throw new Error('Telnyx TURN servers require a username and credential.');
    return { urls, ...(value.username ? { username: value.username } : {}), ...(value.credential ? { credential: value.credential } : {}) };
  });
}
