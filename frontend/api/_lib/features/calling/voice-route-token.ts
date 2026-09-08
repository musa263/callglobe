import { createHmac, timingSafeEqual } from 'node:crypto';
import { requiredEnv } from '../../shared/http.js';

export type VoiceRouteAuthorization = {
  routeId: string;
  organizationId: string;
  destination: string;
  callerId?: string;
  carrierTrunkId?: string;
  carrierRevision?: number;
  carrierGateway?: string;
  callerName?: string;
  callerPhotoUrl?: string;
  callerExtension?: string;
  sourceExtensionId?: string;
  callerSipUsername?: string;
  destinationName?: string;
  destinationExtension?: string;
  destinationExtensionId?: string;
  flow: 'outbound' | 'internal';
  expiresAt: number;
};

function signature(payload: string) {
  return createHmac('sha256', `${requiredEnv('AUTH_SECRET')}:voice-route-token`).update(payload).digest('base64url');
}

export function createVoiceRouteToken(route: Omit<VoiceRouteAuthorization, 'expiresAt'>, lifetimeSeconds = 300) {
  const payload = Buffer.from(JSON.stringify({
    r: route.routeId,
    o: route.organizationId,
    d: route.destination,
    c: route.callerId || '',
    t: route.carrierTrunkId,
    v: route.carrierRevision,
    g: route.carrierGateway,
    n: route.callerName || '',
    p: route.callerPhotoUrl || '',
    x: route.callerExtension || '',
    s: route.sourceExtensionId || '',
    u: route.callerSipUsername || '',
    m: route.destinationName || '',
    y: route.destinationExtension || '',
    i: route.destinationExtensionId || '',
    f: route.flow,
    e: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

/**
 * Checks a route token. `allowExpired` is for reading a call record after the
 * call: the token authorised the call when it was placed, and the record of
 * who placed it and where is still true an hour later even though the token
 * could no longer place another call. The signature is always checked.
 */
export function verifyVoiceRouteToken(token: string, options: { allowExpired?: boolean } = {}): VoiceRouteAuthorization | null {
  try {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) return null;
    const expected = Buffer.from(signature(payload));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof decoded.r !== 'string' || typeof decoded.o !== 'string' || typeof decoded.d !== 'string' || !decoded.d
      || !['outbound', 'internal'].includes(String(decoded.f)) || typeof decoded.e !== 'number'
      || (!options.allowExpired && decoded.e < Math.floor(Date.now() / 1000))) return null;
    const authorization: VoiceRouteAuthorization = {
      routeId: decoded.r,
      organizationId: decoded.o,
      destination: decoded.d,
      flow: decoded.f as 'outbound' | 'internal',
      expiresAt: decoded.e,
    };
    if (typeof decoded.c === 'string' && decoded.c) authorization.callerId = decoded.c;
    if (decoded.t !== undefined || decoded.v !== undefined || decoded.g !== undefined) {
      if (typeof decoded.t !== 'string' || !decoded.t || !Number.isSafeInteger(decoded.v) || Number(decoded.v) < 1
        || typeof decoded.g !== 'string' || !/^byoc_[a-f0-9]{32}$/.test(decoded.g) || decoded.f !== 'outbound') return null;
      authorization.carrierTrunkId = decoded.t;
      authorization.carrierRevision = Number(decoded.v);
      authorization.carrierGateway = decoded.g;
    }
    if (typeof decoded.n === 'string' && decoded.n) authorization.callerName = decoded.n;
    if (typeof decoded.p === 'string' && decoded.p) authorization.callerPhotoUrl = decoded.p;
    if (typeof decoded.x === 'string' && decoded.x) authorization.callerExtension = decoded.x;
    if (typeof decoded.s === 'string' && decoded.s) authorization.sourceExtensionId = decoded.s;
    if (typeof decoded.u === 'string' && decoded.u) authorization.callerSipUsername = decoded.u;
    if (typeof decoded.m === 'string' && decoded.m) authorization.destinationName = decoded.m;
    if (typeof decoded.y === 'string' && decoded.y) authorization.destinationExtension = decoded.y;
    if (typeof decoded.i === 'string' && decoded.i) authorization.destinationExtensionId = decoded.i;
    return authorization;
  } catch {
    return null;
  }
}
