import type { PbxConfig } from './pbx-config-store.js';

type UserProfile = PbxConfig['userProfiles'][string] | undefined;

export function userNoAnswerSeconds(profile: UserProfile, companyDefault: number) {
  const requested = Number(profile?.noAnswerSeconds ?? companyDefault);
  return Number.isFinite(requested) ? Math.min(120, Math.max(10, Math.round(requested))) : 45;
}

export function userVoicemailEnabled(profile: UserProfile, companyEnabled: boolean) {
  return companyEnabled && profile?.voicemailEnabled !== false;
}

export function forwardingTargetForCause(profile: Partial<Pick<NonNullable<UserProfile>, 'forwardBusy' | 'forwardNoAnswer' | 'forwardUnavailable'>> | undefined, cause: string) {
  const normalized = cause.trim().toLowerCase();
  if (normalized === 'user_busy') return profile?.forwardBusy?.trim() || '';
  if (['timeout', 'no_answer', 'call_rejected'].includes(normalized)) return profile?.forwardNoAnswer?.trim() || '';
  return profile?.forwardUnavailable?.trim() || '';
}

export function isUnansweredAgentCause(cause: string) {
  return [
    'timeout', 'no_answer', 'user_busy', 'call_rejected', 'unallocated_number',
    'normal_temporary_failure', 'network_out_of_order', 'recovery_on_timer_expire',
    'service_not_implemented', 'incoming_call_barred', 'destination_out_of_order',
  ].includes(cause.trim().toLowerCase());
}
