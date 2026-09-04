import { parseInternalSipUser } from './internal-sip.js';
import { isVoiceRouteId } from './voice-route-id.js';
import { verifyVoiceRouteToken } from './voice-route-token.js';

/**
 * Was this call authorised, and by what?
 *
 * `/api/voice/route` is where a call is decided: it checks the plan, the
 * outbound policy, the wallet, and that the tenant owns the caller ID it asked
 * for, and it signs all of that into a short-lived route token the client
 * presents on the INVITE. On the carrier's Call Control path the webhook
 * verified that token before dialling. On Vocivo's own SIP edge nothing did —
 * Kamailio read the client's `X-Vocivo-Caller-ID` and `X-Vocivo-Route-ID`
 * headers and passed them to the trunk as fact. Any registered extension could
 * therefore put any number on the world's caller ID displays, and place PSTN
 * calls the API had refused for want of credit.
 *
 * This is the check the edge was missing. Kamailio calls it for every call a
 * client originates and refuses the INVITE unless it comes back with a route.
 */

export type SipCallAuthorization = {
  routeId: string;
  /** The number the trunk may present. Empty for internal calls, which never reach it. */
  callerId: string;
  flow: 'outbound' | 'internal';
  organizationId: string;
};

const e164 = /^\+?[1-9]\d{6,14}$/;

function digits(value: string) {
  return value.replace(/\D/g, '');
}

/**
 * Kamailio's `$rU` — the user part of the request URI, so a bare number for
 * PSTN and a SIP username for an extension — against the destination the API
 * signed. Numbers are compared as digits because a client may or may not send
 * the leading `+`, and the token holds the canonical E.164.
 */
function destinationMatches(destination: string, requestUser: string, flow: 'outbound' | 'internal') {
  const asked = requestUser.trim();
  if (!asked) return false;
  if (flow === 'internal') {
    const user = parseInternalSipUser(destination);
    return Boolean(user) && user!.toLowerCase() === asked.toLowerCase();
  }
  if (!e164.test(asked)) return false;
  const signed = digits(destination);
  return signed.length > 0 && signed === digits(asked);
}

/**
 * The route a token stands for, or null when nothing about it can be trusted:
 * an unsigned or expired token, a route id the edge would not be able to quote
 * safely, a destination other than the one the API authorised, or a token
 * belonging to a different tenant than the credential that authenticated.
 */
export function authorizeSipCall(input: {
  routeToken: string;
  requestUser: string;
  /** The organization the Digest credential belongs to, when the INVITE carried one. */
  organizationId?: string;
}): SipCallAuthorization | null {
  const token = input.routeToken.trim();
  if (!token) return null;
  const route = verifyVoiceRouteToken(token);
  if (!route) return null;
  // The route id is quoted into a shell command by the media host's hangup
  // hook. Nothing but the shape `/api/voice/route` issues may leave here.
  if (!isVoiceRouteId(route.routeId)) return null;
  if (input.organizationId && input.organizationId !== route.organizationId) return null;
  if (!destinationMatches(route.destination, input.requestUser, route.flow)) return null;
  const callerId = route.callerId && e164.test(route.callerId) ? route.callerId : '';
  // A PSTN call with no caller ID of its own would go out as whatever the
  // trunk defaults to, which is another tenant's number as often as not.
  if (route.flow === 'outbound' && !callerId) return null;
  return {
    routeId: route.routeId,
    callerId: route.flow === 'outbound' ? callerId : '',
    flow: route.flow,
    organizationId: route.organizationId,
  };
}
