import { createHmac, timingSafeEqual } from 'node:crypto';
import { requiredEnv } from './http.js';

export type VoiceRouteAuthorization = {
  routeId: string;
  organizationId: string;
  destination: string;
  callerId?: string;
  callerName?: string;
  callerExtension?: string;
  sourceExtensionId?: string;
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
    n: route.callerName || '',
    x: route.callerExtension || '',
    s: route.sourceExtensionId || '',
    m: route.destinationName || '',
    y: route.destinationExtension || '',
    i: route.destinationExtensionId || '',
    f: route.flow,
    e: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyVoiceRouteToken(token: string): VoiceRouteAuthorization | null {
  try {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) return null;
    const expected = Buffer.from(signature(payload));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof decoded.r !== 'string' || typeof decoded.o !== 'string' || typeof decoded.d !== 'string'
      || !['outbound', 'internal'].includes(String(decoded.f)) || typeof decoded.e !== 'number'
      || decoded.e < Math.floor(Date.now() / 1000)) return null;
    const authorization: VoiceRouteAuthorization = {
      routeId: decoded.r,
      organizationId: decoded.o,
      destination: decoded.d,
      flow: decoded.f as 'outbound' | 'internal',
      expiresAt: decoded.e,
    };
    if (typeof decoded.c === 'string' && decoded.c) authorization.callerId = decoded.c;
    if (typeof decoded.n === 'string' && decoded.n) authorization.callerName = decoded.n;
    if (typeof decoded.x === 'string' && decoded.x) authorization.callerExtension = decoded.x;
    if (typeof decoded.s === 'string' && decoded.s) authorization.sourceExtensionId = decoded.s;
    if (typeof decoded.m === 'string' && decoded.m) authorization.destinationName = decoded.m;
    if (typeof decoded.y === 'string' && decoded.y) authorization.destinationExtension = decoded.y;
    if (typeof decoded.i === 'string' && decoded.i) authorization.destinationExtensionId = decoded.i;
    return authorization;
  } catch {
    return null;
  }
}
