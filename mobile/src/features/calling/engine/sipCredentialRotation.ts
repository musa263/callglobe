import type { UserAgent } from 'sip.js';
import type { SipStackConfig } from './sipStack';

/** Rotate authentication on SIP.js's existing UA; media and dialogs are untouched. */
export function rotateSipPassword(agent: Pick<UserAgent, 'configuration'>, current: SipStackConfig, next: SipStackConfig) {
  if (next.username !== current.username || next.domain !== current.domain || next.wsUri !== current.wsUri) {
    throw new Error('Live SIP renewal cannot change calling identity or transport.');
  }
  if (agent.configuration.authorizationPassword === next.password) return false;
  // SIP.js 0.21's authenticationFactory reads these public options per request.
  agent.configuration.authorizationPassword = next.password;
  return true;
}
