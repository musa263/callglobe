/**
 * `quality` is the grade the engine's own authors give the voice (Kokoro
 * VOICES.md, v1.0, A to F). Only a handful sound like a person on a phone
 * line; the rest are recognisably synthetic. The admin used to be offered
 * all of them as equals, alphabetically, and the first receptionist went live
 * on Adam — the lowest-graded voice in the set — which is what "sounds fake"
 * was.
 */
type VoiceSeed = { suffix: string; sourceVoice: string; name: string; gender: 'female' | 'male'; language: string; accent: string; quality: string };

const gradeOrder = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+', 'F'];
export function voiceGradeRank(grade: string) { const index = gradeOrder.indexOf(grade); return index < 0 ? gradeOrder.length : index; }
/** Good enough to answer a business's phone: B- and above. */
export function isRecommendedVoice(grade: string) { return voiceGradeRank(grade) <= gradeOrder.indexOf('B-'); }

const voiceSeeds: VoiceSeed[] = [
  { suffix: 'AfHeart', sourceVoice: 'af_heart', name: 'Amina', gender: 'female', language: 'English', accent: 'American' , quality: 'A' },
  { suffix: 'AfAlloy', sourceVoice: 'af_alloy', name: 'Alloy', gender: 'female', language: 'English', accent: 'American' , quality: 'C' },
  { suffix: 'AfAoede', sourceVoice: 'af_aoede', name: 'Aoede', gender: 'female', language: 'English', accent: 'American' , quality: 'C+' },
  { suffix: 'AfBella', sourceVoice: 'af_bella', name: 'Bella', gender: 'female', language: 'English', accent: 'American' , quality: 'A-' },
  { suffix: 'AfJessica', sourceVoice: 'af_jessica', name: 'Jessica', gender: 'female', language: 'English', accent: 'American' , quality: 'D' },
  { suffix: 'AfKore', sourceVoice: 'af_kore', name: 'Kore', gender: 'female', language: 'English', accent: 'American' , quality: 'C+' },
  { suffix: 'AfNicole', sourceVoice: 'af_nicole', name: 'Nicole', gender: 'female', language: 'English', accent: 'American' , quality: 'B-' },
  { suffix: 'AfNova', sourceVoice: 'af_nova', name: 'Nova', gender: 'female', language: 'English', accent: 'American' , quality: 'C' },
  { suffix: 'AfRiver', sourceVoice: 'af_river', name: 'River', gender: 'female', language: 'English', accent: 'American' , quality: 'D' },
  { suffix: 'AfSarah', sourceVoice: 'af_sarah', name: 'Sarah', gender: 'female', language: 'English', accent: 'American' , quality: 'C+' },
  { suffix: 'AfSky', sourceVoice: 'af_sky', name: 'Sky', gender: 'female', language: 'English', accent: 'American' , quality: 'C-' },
  { suffix: 'AmAdam', sourceVoice: 'am_adam', name: 'Adam', gender: 'male', language: 'English', accent: 'American' , quality: 'F+' },
  { suffix: 'AmEcho', sourceVoice: 'am_echo', name: 'Echo', gender: 'male', language: 'English', accent: 'American' , quality: 'D' },
  { suffix: 'AmEric', sourceVoice: 'am_eric', name: 'Eric', gender: 'male', language: 'English', accent: 'American' , quality: 'D' },
  { suffix: 'AmFenrir', sourceVoice: 'am_fenrir', name: 'Fenrir', gender: 'male', language: 'English', accent: 'American' , quality: 'C+' },
  { suffix: 'AmLiam', sourceVoice: 'am_liam', name: 'Liam', gender: 'male', language: 'English', accent: 'American' , quality: 'D' },
  { suffix: 'AmMichael', sourceVoice: 'am_michael', name: 'Michael', gender: 'male', language: 'English', accent: 'American' , quality: 'C+' },
  { suffix: 'AmOnyx', sourceVoice: 'am_onyx', name: 'Onyx', gender: 'male', language: 'English', accent: 'American' , quality: 'D' },
  { suffix: 'AmPuck', sourceVoice: 'am_puck', name: 'Puck', gender: 'male', language: 'English', accent: 'American' , quality: 'C+' },
  { suffix: 'AmSanta', sourceVoice: 'am_santa', name: 'Nicholas', gender: 'male', language: 'English', accent: 'American' , quality: 'D-' },
  { suffix: 'BfAlice', sourceVoice: 'bf_alice', name: 'Alice', gender: 'female', language: 'English', accent: 'British' , quality: 'D' },
  { suffix: 'BfEmma', sourceVoice: 'bf_emma', name: 'Emma', gender: 'female', language: 'English', accent: 'British' , quality: 'B-' },
  { suffix: 'BfIsabella', sourceVoice: 'bf_isabella', name: 'Isabella', gender: 'female', language: 'English', accent: 'British' , quality: 'C' },
  { suffix: 'BfLily', sourceVoice: 'bf_lily', name: 'Lily', gender: 'female', language: 'English', accent: 'British' , quality: 'D' },
  { suffix: 'BmDaniel', sourceVoice: 'bm_daniel', name: 'Daniel', gender: 'male', language: 'English', accent: 'British' , quality: 'D' },
  { suffix: 'BmFable', sourceVoice: 'bm_fable', name: 'Fable', gender: 'male', language: 'English', accent: 'British' , quality: 'C' },
  { suffix: 'BmGeorge', sourceVoice: 'bm_george', name: 'George', gender: 'male', language: 'English', accent: 'British' , quality: 'C' },
  { suffix: 'BmLewis', sourceVoice: 'bm_lewis', name: 'Lewis', gender: 'male', language: 'English', accent: 'British' , quality: 'D+' },
  { suffix: 'EfDora', sourceVoice: 'ef_dora', name: 'Dora', gender: 'female', language: 'Spanish', accent: 'Spanish' , quality: 'C' },
  { suffix: 'EmAlex', sourceVoice: 'em_alex', name: 'Alex', gender: 'male', language: 'Spanish', accent: 'Spanish' , quality: 'C' },
  { suffix: 'EmSanta', sourceVoice: 'em_santa', name: 'Santiago', gender: 'male', language: 'Spanish', accent: 'Spanish' , quality: 'C' },
  { suffix: 'FfSiwis', sourceVoice: 'ff_siwis', name: 'Siwis', gender: 'female', language: 'French', accent: 'French' , quality: 'B-' },
  { suffix: 'IfSara', sourceVoice: 'if_sara', name: 'Sara', gender: 'female', language: 'Italian', accent: 'Italian' , quality: 'C' },
  { suffix: 'ImNicola', sourceVoice: 'im_nicola', name: 'Nicola', gender: 'male', language: 'Italian', accent: 'Italian' , quality: 'C' },
  { suffix: 'PfDora', sourceVoice: 'pf_dora', name: 'Dora BR', gender: 'female', language: 'Portuguese', accent: 'Brazilian' , quality: 'C' },
  { suffix: 'PmAlex', sourceVoice: 'pm_alex', name: 'Alex BR', gender: 'male', language: 'Portuguese', accent: 'Brazilian' , quality: 'C' },
  { suffix: 'PmSanta', sourceVoice: 'pm_santa', name: 'Mateus', gender: 'male', language: 'Portuguese', accent: 'Brazilian' , quality: 'C' },
];

export const vocivoVoices = voiceSeeds.map((voice) => ({
  id: `Vocivo.Kokoro.${voice.suffix}`,
  provider: 'vocivo' as const,
  sourceVoice: voice.sourceVoice,
  name: voice.name,
  gender: voice.gender,
  language: voice.language,
  accent: voice.accent,
  quality: voice.quality,
  recommended: isRecommendedVoice(voice.quality),
  fallbackVoice: `Telnyx.KokoroTTS.${voice.sourceVoice}`,
})).sort((left, right) => voiceGradeRank(left.quality) - voiceGradeRank(right.quality) || left.name.localeCompare(right.name));

export function isVocivoVoice(voice: string) { return vocivoVoices.some((item) => item.id === voice); }
export function voiceDefinition(voice: string) { return vocivoVoices.find((item) => item.id === voice); }
export function carrierFallbackVoice(voice: string) { return voiceDefinition(voice)?.fallbackVoice || voice; }

/**
 * The voice a tenant chose before the switch to Vocivo's own speech is a
 * carrier voice id. On the SIP edge that must not turn into a carrier
 * synthesis on every prompt, so anything that is not one of Vocivo's voices
 * is spoken by Vocivo's default voice while the service is configured.
 */
export const defaultVocivoVoice = 'Vocivo.Kokoro.AfHeart';

export function promptVoice(voice: string, serviceConfigured = Boolean(process.env.TTS_SERVICE_URL?.trim())) {
  if (voiceDefinition(voice)) return voice;
  return serviceConfigured ? defaultVocivoVoice : voice;
}

export async function renderVocivoPrompt(text: string, voice: string, timeoutMs = 12_000) {
  const definition = voiceDefinition(voice);
  const serviceUrl = process.env.TTS_SERVICE_URL?.replace(/\/$/, '');
  if (!definition || !serviceUrl) return null;
  try {
    const response = await fetch(`${serviceUrl}/v1/audio/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.TTS_SERVICE_SECRET ? { Authorization: `Bearer ${process.env.TTS_SERVICE_SECRET}` } : {}) },
      body: JSON.stringify({ input: text.slice(0, 2000), voice: definition.sourceVoice, format: 'wav' }),
      // Kokoro synthesises on CPU: a first render of an unseen prompt takes seconds,
      // and 3.5s was short enough to fall back to the carrier voice on every cold prompt.
      // Repeat renders are served from the content-addressed cache and return immediately.
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
    });
    if (!response.ok) throw new Error(`TTS service returned ${response.status}`);
    const payload = await response.json() as { audio_url?: string };
    return payload.audio_url && /^https:\/\//.test(payload.audio_url) ? payload.audio_url : null;
  } catch (error) {
    console.error('Vocivo TTS render failed; using carrier fallback.', error);
    return null;
  }
}
