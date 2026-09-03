import type { ExtensionUser } from './pbx.js';
import type { PbxConfig } from './pbx-config-store.js';
import { normalizeE164 } from './tenancy.js';

/**
 * The control plane for Vocivo's own AI receptionist.
 *
 * The receptionist itself runs on the SIP edge — FreeSWITCH for the call,
 * faster-whisper for what the caller said, Kokoro for what it says back. This
 * module answers the only two questions that service asks of the API: which
 * receptionist answers for the number that was dialled, and here is what
 * happened on the call.
 *
 * Nothing here talks to a carrier. The equivalent Telnyx path sent the
 * assistant's definition, the caller's audio and the transcript to Telnyx, and
 * billed per minute of it.
 */

export type ReceptionistTarget = { extension: string; label: string };

export type ReceptionistProfile = {
  enabled: boolean;
  organizationId: string;
  name: string;
  greeting: string;
  instructions: string;
  voice: string;
  language: string;
  transferEnabled: boolean;
  fallbackExtension: string;
  targets: ReceptionistTarget[];
};

export type ReceptionistOutcome =
  | 'completed'
  | 'transferred'
  | 'message_taken'
  | 'caller_hung_up'
  | 'no_speech'
  | 'turn_limit'
  | 'error';

export type ReceptionistConversation = {
  callId: string;
  number: string;
  caller: string;
  outcome: ReceptionistOutcome;
  transferredTo: string;
  seconds: number;
  transcript: string;
  note: string;
};

const outcomes: ReceptionistOutcome[] = [
  'completed', 'transferred', 'message_taken', 'caller_hung_up', 'no_speech', 'turn_limit', 'error',
];

/**
 * Kokoro's voices, keyed by the name stored on the tenant's assistant.
 *
 * Existing tenants carry carrier voice names such as `Telnyx.Bayan.Amanda`,
 * chosen before there was anywhere else for them to come from. Rather than
 * migrate every record, those names map onto the nearest self-hosted voice —
 * so switching the edge over does not silently mute a receptionist.
 */
const voiceAliases: Record<string, string> = {
  'Telnyx.KokoroTTS.af': 'af_heart',
  'Telnyx.Bayan.Amanda': 'af_heart',
  'Telnyx.Bayan.Bella': 'af_bella',
  'Telnyx.Bayan.Adam': 'am_adam',
  'Telnyx.Bayan.Michael': 'am_michael',
};

const selfHostedVoices = new Set(['af_heart', 'af_bella', 'am_adam', 'am_michael']);

export function receptionistVoice(stored: string): string {
  const trimmed = (stored || '').trim();
  if (selfHostedVoices.has(trimmed)) return trimmed;
  return voiceAliases[trimmed] || 'af_heart';
}

/**
 * Who the receptionist may put a caller through to.
 *
 * Only active extensions with a SIP username: an extension nobody can answer
 * is worse than no transfer at all, because the caller has already been told
 * they are being put through.
 */
export function transferTargets(extensions: ExtensionUser[]): ReceptionistTarget[] {
  return extensions
    .filter((entry) => entry.status === 'active' && entry.sipUsername && entry.extension)
    .map((entry) => ({
      extension: String(entry.extension),
      label: (entry.name || '').trim() || entry.email || String(entry.extension),
    }));
}

export type ProfileInput = {
  number: string;
  config: PbxConfig;
  /** Organization-scoped view, as `pbxForOrganization` returns it. */
  tenantFor: (organizationId: string) => PbxConfig;
  extensionsFor: (organizationId: string) => Promise<ExtensionUser[]>;
};

/**
 * Resolves the dialled number to a receptionist, or to nothing.
 *
 * Returning null is a normal answer and the edge releases the call: a number
 * with no receptionist should never have been routed here, and answering it
 * with some other tenant's assistant would be worse than a busy tone.
 */
export async function receptionistFor(input: ProfileInput): Promise<ReceptionistProfile | null> {
  const did = normalizeE164(input.number);
  const assignment = input.config.numberAssignments[did];
  if (!assignment?.organizationId) return null;

  const tenant = input.tenantFor(assignment.organizationId);
  const ai = tenant.ai;
  if (!ai?.enabled) return null;

  const extensions = await input.extensionsFor(assignment.organizationId);
  const targets = ai.transferEnabled ? transferTargets(extensions) : [];
  const fallback = ai.fallbackExtension && targets.some((target) => target.extension === ai.fallbackExtension)
    ? ai.fallbackExtension
    : '';

  return {
    enabled: true,
    organizationId: assignment.organizationId,
    name: ai.name,
    greeting: ai.greeting,
    // The knowledge base is part of the brief, not a separate retrieval step:
    // a receptionist's worth of company facts fits in a prompt.
    instructions: [ai.instructions, ai.knowledge].filter((part) => part && part.trim()).join('\n\n'),
    voice: receptionistVoice(ai.voice),
    language: ai.language || 'en',
    transferEnabled: Boolean(ai.transferEnabled) && targets.length > 0,
    fallbackExtension: fallback,
    targets,
  };
}

/** Validates what the edge reports about a finished call before it is stored. */
export function parseConversation(body: unknown): ReceptionistConversation | null {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  if (!source) return null;
  const callId = typeof source.callId === 'string' ? source.callId.trim() : '';
  if (!callId) return null;
  const outcome = typeof source.outcome === 'string' && (outcomes as string[]).includes(source.outcome)
    ? source.outcome as ReceptionistOutcome
    : 'error';
  const seconds = Number(source.seconds);
  return {
    callId: callId.slice(0, 128),
    number: typeof source.number === 'string' ? normalizeE164(source.number) : '',
    caller: typeof source.caller === 'string' ? source.caller.slice(0, 64) : '',
    outcome,
    transferredTo: typeof source.transferredTo === 'string' ? source.transferredTo.slice(0, 16) : '',
    seconds: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 10) / 10 : 0,
    // A transcript is a record of a real conversation, so it is bounded rather
    // than trusted: the edge is ours, but the caller's words are not.
    transcript: typeof source.transcript === 'string' ? source.transcript.slice(0, 20_000) : '',
    note: typeof source.note === 'string' ? source.note.slice(0, 2_000) : '',
  };
}
