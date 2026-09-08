export type SipAnswerFailure = 'accept_rejected' | 'answer_timeout' | 'invite_timeout' | 'wake_failed' | 'ended_during_answer' | 'native_end_during_answer';

/** Release-visible failure metadata. Never log SIP messages, credentials or caller identity. */
export function reportSipAnswerFailure(callId: string, phase: SipAnswerFailure, invited: boolean, started: boolean) {
  console.error('[Vocivo SIP answer failure]', {
    callId: /^[a-zA-Z0-9_-]{1,128}$/.test(callId) ? callId : 'unavailable',
    phase, invited, started,
  });
}
