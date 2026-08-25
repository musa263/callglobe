export const vocivoVoices = [
  { id: 'Vocivo.Kokoro.AfHeart', provider: 'vocivo', sourceVoice: 'af_heart', name: 'Amina', gender: 'female', language: 'English', accent: 'American', fallbackVoice: 'AWS.Polly.Joanna-Neural' },
  { id: 'Vocivo.Kokoro.AfBella', provider: 'vocivo', sourceVoice: 'af_bella', name: 'Bella', gender: 'female', language: 'English', accent: 'American', fallbackVoice: 'AWS.Polly.Joanna-Neural' },
  { id: 'Vocivo.Kokoro.AmAdam', provider: 'vocivo', sourceVoice: 'am_adam', name: 'Adam', gender: 'male', language: 'English', accent: 'American', fallbackVoice: 'AWS.Polly.Matthew-Neural' },
  { id: 'Vocivo.Kokoro.AmMichael', provider: 'vocivo', sourceVoice: 'am_michael', name: 'Michael', gender: 'male', language: 'English', accent: 'American', fallbackVoice: 'AWS.Polly.Matthew-Neural' },
] as const;

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
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`TTS service returned ${response.status}`);
    const payload = await response.json() as { audio_url?: string };
    return payload.audio_url && /^https:\/\//.test(payload.audio_url) ? payload.audio_url : null;
  } catch (error) {
    console.error('Vocivo TTS render failed; using carrier fallback.', error);
    return null;
  }
}
