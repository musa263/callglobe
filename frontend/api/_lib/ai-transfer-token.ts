import { createHmac, timingSafeEqual } from 'node:crypto';
import { requiredEnv } from './http.js';

export type AiTransferAuthorization = {
  callControlId: string;
  organizationId: string;
  inboundNumber: string;
  callerNumber?: string;
  callerName?: string;
  assistantId: string;
  expiresAt: number;
};

function signature(payload: string) {
  return createHmac('sha256', `${requiredEnv('AUTH_SECRET')}:ai-extension-transfer`).update(payload).digest('base64url');
}

export function createAiTransferToken(
  input: Omit<AiTransferAuthorization, 'expiresAt'>,
  lifetimeSeconds = 15 * 60,
) {
  const payload = Buffer.from(JSON.stringify({
    c: input.callControlId,
    o: input.organizationId,
    i: input.inboundNumber,
    n: input.callerNumber || '',
    d: input.callerName || '',
    a: input.assistantId,
    e: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyAiTransferToken(token: string): AiTransferAuthorization | null {
  try {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) return null;
    const expected = Buffer.from(signature(payload));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof value.c !== 'string' || !value.c
      || typeof value.o !== 'string' || !value.o
      || typeof value.i !== 'string' || !value.i
      || typeof value.a !== 'string' || !value.a
      || typeof value.e !== 'number'
      || value.e < Math.floor(Date.now() / 1000)) return null;
    return {
      callControlId: value.c,
      organizationId: value.o,
      inboundNumber: value.i,
      callerNumber: typeof value.n === 'string' && value.n ? value.n : undefined,
      callerName: typeof value.d === 'string' && value.d ? value.d : undefined,
      assistantId: value.a,
      expiresAt: value.e,
    };
  } catch {
    return null;
  }
}
