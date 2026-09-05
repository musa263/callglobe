import type { PbxConfig } from '../organizations/pbx-config-store.js';

/**
 * What a company administrator may change about their receptionist.
 *
 * The save handler used to merge the request body straight over the stored
 * settings, which meant every field was writable — including `assistantId`,
 * the id of the assistant this tenant owns at the carrier. An administrator
 * who sent another tenant's id had their own name, instructions and voice
 * written over that tenant's assistant, and then kept the id as their own.
 * It also meant any key at all could be persisted into the configuration.
 *
 * So the settings are picked, one by one, and the assistant id is not among
 * them: it belongs to the platform and is set only by the carrier's answer.
 */

export type AiSettings = PbxConfig['ai'];

const limits = {
  name: 120,
  greeting: 600,
  // The brief and the knowledge base are both spoken material and both go into
  // the model's system prompt; long enough for a real business's notes, short
  // enough that one tenant cannot make the shared configuration unreadable.
  instructions: 8000,
  knowledge: 24000,
  voice: 120,
  language: 8,
  fallbackExtension: 8,
} as const;

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : undefined;
}

function flag(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

/** The settings named in `body`, ignoring anything else it carries. */
export function aiSettingsFromRequest(body: unknown): Partial<AiSettings> {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const picked: Partial<AiSettings> = {};
  const strings = ['name', 'greeting', 'instructions', 'knowledge', 'voice', 'language', 'fallbackExtension'] as const;
  for (const field of strings) {
    const value = text(source[field], limits[field]);
    if (value !== undefined) picked[field] = value;
  }
  for (const field of ['enabled', 'transferEnabled', 'summariesEnabled'] as const) {
    const value = flag(source[field]);
    if (value !== undefined) picked[field] = value;
  }
  return picked;
}

/** The tenant's receptionist as it will be stored: their edits, our assistant id. */
export function nextAiSettings(current: AiSettings, body: unknown): AiSettings {
  return { ...current, ...aiSettingsFromRequest(body), assistantId: current.assistantId };
}
