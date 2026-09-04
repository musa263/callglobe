import type { PbxConfig } from './pbx-config-store.js';

/**
 * What a person may decide about their own extension.
 *
 * Voicemail, how long their phone rings first, whether they follow the
 * office hours, a second number to ring alongside, and where a call goes when
 * they cannot be reached. An administrator sets all of this on the Users
 * screen; until now nobody could set it for themselves, and on the phone the
 * voicemail row was only shown to administrators at all — so a person whose
 * extension is an ordinary user had no voicemail switch anywhere.
 *
 * The permissions and the caller ID stay the administrator's.
 */

export type UserProfile = PbxConfig['userProfiles'][string];

export type CallPreferences = {
  voicemailEnabled: boolean;
  noAnswerSeconds: number;
  schedule: 'Always available' | 'Use office hours';
  simultaneousRing: string;
  forwardUnavailable: string;
};

export function defaultUserProfile(): UserProfile {
  return {
    outboundCallerId: '', did: '', twoFactorEnabled: false, noAnswerSeconds: 25,
    forwardBusy: '', forwardNoAnswer: '', forwardUnavailable: '', simultaneousRing: '',
    voicemailEnabled: true, voicemailEmail: false, voicemailTranscription: false,
    schedule: 'Always available',
    permissions: { international: false, transfer: false, video: false, recording: false, reports: false },
  };
}

export function callPreferencesFrom(profile: UserProfile | undefined): CallPreferences {
  const base = profile || defaultUserProfile();
  return {
    voicemailEnabled: base.voicemailEnabled !== false,
    noAnswerSeconds: Number.isFinite(base.noAnswerSeconds) ? base.noAnswerSeconds : 25,
    schedule: base.schedule === 'Use office hours' ? 'Use office hours' : 'Always available',
    simultaneousRing: base.simultaneousRing || '',
    forwardUnavailable: base.forwardUnavailable || '',
  };
}

const forwardingTarget = /^(?:|voicemail|\d{2,5}|\+[1-9]\d{6,14})$/i;

function target(value: unknown, current: string) {
  if (typeof value !== 'string') return current;
  const cleaned = value.replace(/[\s()-]/g, '').slice(0, 24);
  if (!forwardingTarget.test(cleaned)) throw new Error('Forwarding destinations must be an extension, a complete international number, or voicemail.');
  return cleaned;
}

/** The profile as it will be stored once this person has had their say. */
export function applyCallPreferences(profile: UserProfile | undefined, body: unknown): UserProfile {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const next: UserProfile = { ...defaultUserProfile(), ...(profile || {}) };
  if (typeof source.voicemailEnabled === 'boolean') next.voicemailEnabled = source.voicemailEnabled;
  if (source.noAnswerSeconds !== undefined) {
    const seconds = Number(source.noAnswerSeconds);
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 120) throw new Error('Ring time must be between 10 and 120 seconds.');
    next.noAnswerSeconds = Math.round(seconds);
  }
  if (source.schedule !== undefined) {
    if (source.schedule !== 'Always available' && source.schedule !== 'Use office hours') throw new Error('Choose "Always available" or "Use office hours".');
    next.schedule = source.schedule;
  }
  next.simultaneousRing = target(source.simultaneousRing, next.simultaneousRing);
  next.forwardUnavailable = target(source.forwardUnavailable, next.forwardUnavailable);
  return next;
}
