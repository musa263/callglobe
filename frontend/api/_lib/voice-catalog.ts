type VoiceSeed = { suffix: string; sourceVoice: string; name: string; gender: 'female' | 'male'; language: string; accent: string };

const voiceSeeds: VoiceSeed[] = [
  { suffix: 'AfHeart', sourceVoice: 'af_heart', name: 'Amina', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfAlloy', sourceVoice: 'af_alloy', name: 'Alloy', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfAoede', sourceVoice: 'af_aoede', name: 'Aoede', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfBella', sourceVoice: 'af_bella', name: 'Bella', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfJessica', sourceVoice: 'af_jessica', name: 'Jessica', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfKore', sourceVoice: 'af_kore', name: 'Kore', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfNicole', sourceVoice: 'af_nicole', name: 'Nicole', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfNova', sourceVoice: 'af_nova', name: 'Nova', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfRiver', sourceVoice: 'af_river', name: 'River', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfSarah', sourceVoice: 'af_sarah', name: 'Sarah', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AfSky', sourceVoice: 'af_sky', name: 'Sky', gender: 'female', language: 'English', accent: 'American' },
  { suffix: 'AmAdam', sourceVoice: 'am_adam', name: 'Adam', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'AmEcho', sourceVoice: 'am_echo', name: 'Echo', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'AmEric', sourceVoice: 'am_eric', name: 'Eric', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'AmFenrir', sourceVoice: 'am_fenrir', name: 'Fenrir', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'AmLiam', sourceVoice: 'am_liam', name: 'Liam', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'AmMichael', sourceVoice: 'am_michael', name: 'Michael', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'AmOnyx', sourceVoice: 'am_onyx', name: 'Onyx', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'AmPuck', sourceVoice: 'am_puck', name: 'Puck', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'AmSanta', sourceVoice: 'am_santa', name: 'Nicholas', gender: 'male', language: 'English', accent: 'American' },
  { suffix: 'BfAlice', sourceVoice: 'bf_alice', name: 'Alice', gender: 'female', language: 'English', accent: 'British' },
  { suffix: 'BfEmma', sourceVoice: 'bf_emma', name: 'Emma', gender: 'female', language: 'English', accent: 'British' },
  { suffix: 'BfIsabella', sourceVoice: 'bf_isabella', name: 'Isabella', gender: 'female', language: 'English', accent: 'British' },
  { suffix: 'BfLily', sourceVoice: 'bf_lily', name: 'Lily', gender: 'female', language: 'English', accent: 'British' },
  { suffix: 'BmDaniel', sourceVoice: 'bm_daniel', name: 'Daniel', gender: 'male', language: 'English', accent: 'British' },
  { suffix: 'BmFable', sourceVoice: 'bm_fable', name: 'Fable', gender: 'male', language: 'English', accent: 'British' },
  { suffix: 'BmGeorge', sourceVoice: 'bm_george', name: 'George', gender: 'male', language: 'English', accent: 'British' },
  { suffix: 'BmLewis', sourceVoice: 'bm_lewis', name: 'Lewis', gender: 'male', language: 'English', accent: 'British' },
  { suffix: 'EfDora', sourceVoice: 'ef_dora', name: 'Dora', gender: 'female', language: 'Spanish', accent: 'Spanish' },
  { suffix: 'EmAlex', sourceVoice: 'em_alex', name: 'Alex', gender: 'male', language: 'Spanish', accent: 'Spanish' },
  { suffix: 'EmSanta', sourceVoice: 'em_santa', name: 'Santiago', gender: 'male', language: 'Spanish', accent: 'Spanish' },
  { suffix: 'FfSiwis', sourceVoice: 'ff_siwis', name: 'Siwis', gender: 'female', language: 'French', accent: 'French' },
  { suffix: 'IfSara', sourceVoice: 'if_sara', name: 'Sara', gender: 'female', language: 'Italian', accent: 'Italian' },
  { suffix: 'ImNicola', sourceVoice: 'im_nicola', name: 'Nicola', gender: 'male', language: 'Italian', accent: 'Italian' },
  { suffix: 'PfDora', sourceVoice: 'pf_dora', name: 'Dora BR', gender: 'female', language: 'Portuguese', accent: 'Brazilian' },
  { suffix: 'PmAlex', sourceVoice: 'pm_alex', name: 'Alex BR', gender: 'male', language: 'Portuguese', accent: 'Brazilian' },
  { suffix: 'PmSanta', sourceVoice: 'pm_santa', name: 'Mateus', gender: 'male', language: 'Portuguese', accent: 'Brazilian' },
];

export const vocivoVoices = voiceSeeds.map((voice) => ({
  id: `Vocivo.Kokoro.${voice.suffix}`,
  provider: 'vocivo' as const,
  sourceVoice: voice.sourceVoice,
  name: voice.name,
  gender: voice.gender,
  language: voice.language,
  accent: voice.accent,
  fallbackVoice: `Telnyx.KokoroTTS.${voice.sourceVoice}`,
}));

export function isVocivoVoice(voice: string) { return vocivoVoices.some((item) => item.id === voice); }
export function voiceDefinition(voice: string) { return vocivoVoices.find((item) => item.id === voice); }
export function carrierFallbackVoice(voice: string) { return voiceDefinition(voice)?.fallbackVoice || voice; }

export async function renderVocivoPrompt(text: string, voice: string) {
  const definition = voiceDefinition(voice);
  const serviceUrl = process.env.TTS_SERVICE_URL?.replace(/\/$/, '');
  if (!definition || !serviceUrl) return null;
  try {
    const response = await fetch(`${serviceUrl}/v1/audio/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.TTS_SERVICE_SECRET ? { Authorization: `Bearer ${process.env.TTS_SERVICE_SECRET}` } : {}) },
      body: JSON.stringify({ input: text.slice(0, 2000), voice: definition.sourceVoice, format: 'wav' }),
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) throw new Error(`TTS service returned ${response.status}`);
    const payload = await response.json() as { audio_url?: string };
    return payload.audio_url && /^https:\/\//.test(payload.audio_url) ? payload.audio_url : null;
  } catch (error) {
    console.error('Vocivo TTS render failed; using carrier fallback.', error);
    return null;
  }
}
