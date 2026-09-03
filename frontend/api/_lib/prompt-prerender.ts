import { readBusinessVoiceConfig } from './number-config.js';
import { listExtensions } from './pbx.js';
import { pbxForOrganization, readPbxConfig, type PbxConfig } from './pbx-config-store.js';
import { receptionistPhrases, receptionistVoice } from './receptionist.js';
import { dialplanPromptTexts } from './sip-dialplan.js';
import { defaultVocivoVoice, promptVoice, voiceDefinition } from './voice-catalog.js';

/**
 * Has the voice engine render a tenant's prompts before a caller needs them.
 *
 * The engine keeps every rendered sentence, so this is only about *when* the
 * work happens: at save time in the admin, in the background, rather than in
 * the first second of a live call. A cold render took eight to twenty seconds
 * on the SIP edge — the caller heard silence, or the carrier's timeout, and
 * the half-heard, sometimes-silent prompts the tenant reported were exactly
 * the prompts that had not been rendered yet.
 *
 * Everything here is best effort and returns quickly: the engine answers 202
 * and renders on its own time, and a tenant's save never fails because the
 * engine is down.
 */

export type PrerenderItem = { input: string; voice: string };

function engine() {
  const url = process.env.TTS_SERVICE_URL?.trim().replace(/\/+$/, '');
  return url ? { url, secret: process.env.TTS_SERVICE_SECRET?.trim() || '' } : null;
}

/** The engine's own voice id for whatever the tenant's record holds. */
function engineVoice(stored: string) {
  const definition = voiceDefinition(promptVoice(stored, true));
  return definition?.sourceVoice || voiceDefinition(defaultVocivoVoice)!.sourceVoice;
}

export async function prerenderPrompts(items: PrerenderItem[], fetchImpl: typeof fetch = fetch): Promise<{ queued: number; cached: number } | null> {
  const service = engine();
  const batch = items
    .map((item) => ({ input: item.input.trim().slice(0, 2000), voice: item.voice }))
    .filter((item) => item.input);
  if (!service || !batch.length) return null;
  try {
    const response = await fetchImpl(`${service.url}/v1/audio/prerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(service.secret ? { Authorization: `Bearer ${service.secret}` } : {}) },
      body: JSON.stringify({ items: batch.slice(0, 64) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.warn('Vocivo prompt pre-render was refused by the voice engine.', response.status);
      return null;
    }
    return await response.json() as { queued: number; cached: number };
  } catch (error) {
    console.warn('Vocivo prompt pre-render could not reach the voice engine.', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * The pieces the receptionist speaks a text in — one sentence at a time, so
 * the first plays while the next renders. Mirrors `split_sentences` in
 * services/receptionist/app/speech.py exactly (same boundary, same minimum,
 * same cap): the engine's cache is keyed on the text, so what is pre-rendered
 * here has to be what the receptionist asks for on the call.
 */
export function splitSpokenSentences(text: string, minimum = 12, maximumParts = 8): string[] {
  const cleaned = text.split(/\s+/).filter(Boolean).join(' ');
  if (!cleaned) return [];
  const parts: string[] = [];
  for (const piece of cleaned.split(/(?<=[.!?…])\s+/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    if (parts.length && (parts[parts.length - 1].length < minimum || trimmed.length < minimum)) {
      parts[parts.length - 1] = `${parts[parts.length - 1]} ${trimmed}`;
    } else {
      parts.push(trimmed);
    }
  }
  if (parts.length > maximumParts) {
    return [...parts.slice(0, maximumParts - 1), parts.slice(maximumParts - 1).join(' ')];
  }
  return parts;
}

/**
 * The receptionist's fixed sentences plus its greeting, in its voice and in
 * the pieces it speaks them in. Exported so the list can be checked without
 * a store.
 */
export function receptionistPrerenderItems(ai: PbxConfig['ai']): PrerenderItem[] {
  if (!ai?.enabled) return [];
  const voice = receptionistVoice(ai.voice);
  const pieces = new Set<string>();
  for (const text of [ai.greeting, ...receptionistPhrases]) {
    for (const piece of splitSpokenSentences(text)) pieces.add(piece);
  }
  return [...pieces].map((input) => ({ input, voice }));
}

/**
 * Every prompt the tenant's callers can hear: the dialplan's menu, waiting and
 * voicemail prompts in the business voice, and the receptionist's phrases in
 * its voice. Called after a save of any of the settings those prompts come from.
 */
export async function prerenderTenantPrompts(organizationId: string, options: { config?: PbxConfig; fetchImpl?: typeof fetch } = {}) {
  if (!engine()) return null;
  const config = options.config || await readPbxConfig();
  const pbx = pbxForOrganization(config, organizationId);
  const [business, extensions] = await Promise.all([
    readBusinessVoiceConfig(organizationId),
    listExtensions(organizationId),
  ]);
  const dialplan = dialplanPromptTexts({ pbx, business, extensions, organizationId });
  const businessVoice = engineVoice(dialplan.voice);
  const items: PrerenderItem[] = [
    ...dialplan.texts.map((input) => ({ input, voice: businessVoice })),
    ...receptionistPrerenderItems(pbx.ai),
  ];
  return prerenderPrompts(items, options.fetchImpl);
}
