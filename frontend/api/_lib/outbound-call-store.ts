import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { transactObjectGroup } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';
import { requiredEnv } from './http.js';

export type OutboundTerminationState = {
  status: 'pending' | 'terminated' | 'retryable_failed' | 'permanent_failed';
  attempts: number;
  lastError?: string;
  updatedAt: string;
};

export type OutboundCallPair = {
  clientCallControlId: string;
  destinationCallControlId: string;
  routeId?: string;
  destination: string;
  status: 'direct' | 'merging' | 'conference';
  phase?: 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed';
  failureCause?: string;
  connectedAt?: string;
  conferenceId?: string;
  conferenceRole?: 'host' | 'released';
  peerClientCallControlId?: string;
  peerDestinationCallControlId?: string;
  forkDestinationCallControlIds?: string[];
  selectedDestinationCallControlId?: string;
  bridgeOnAnswer?: boolean;
  termination?: Record<string, OutboundTerminationState>;
  version?: number;
  updatedAt: string;
};

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:outbound-calls`).digest(); }
function idHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function path(kind: 'client' | 'destination' | 'route', id: string) { return `vocivo/outbound-calls/${kind}-${idHash(id)}.bin`; }
function encrypt(value: OutboundCallPair) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as OutboundCallPair;
}
export function liveOutboundDestinationId(pair: OutboundCallPair) {
  return pair.selectedDestinationCallControlId || pair.destinationCallControlId || '';
}

async function readPath(pathname: string) {
  const value = await readStoredObject(pathname);
  if (!value) return null;
  try {
    return decrypt(value);
  } catch (error) {
    console.error('[outbound-call-store] stored call pair could not be decrypted', { pathname, error });
    return null;
  }
}

function destinationIds(pair: OutboundCallPair) {
  return [...new Set([pair.destinationCallControlId, ...(pair.forkDestinationCallControlIds || [])].filter(Boolean))];
}

function pairPaths(pair: OutboundCallPair) {
  const paths = [path('client', pair.clientCallControlId), ...destinationIds(pair).map((id) => path('destination', id))];
  if (pair.routeId) paths.push(path('route', pair.routeId));
  return [...new Set(paths)];
}

function canonicalPath(pair: OutboundCallPair) {
  return pair.routeId ? path('route', pair.routeId) : path('client', pair.clientCallControlId);
}

function lockKey(pair: OutboundCallPair) {
  return `vocivo:outbound-call:${pair.routeId || pair.clientCallControlId}`;
}

const phaseOrder: Record<NonNullable<OutboundCallPair['phase']>, number> = {
  dialing: 0, ringing: 1, connected: 2, ended: 3, failed: 3,
};

export function mergeOutboundCallPair(current: OutboundCallPair | null, proposed: OutboundCallPair): OutboundCallPair {
  if (!current) return { ...proposed, version: 1 };
  const currentPhase = current.phase || 'dialing';
  const proposedPhase = proposed.phase || currentPhase;
  const terminal = currentPhase === 'ended' || currentPhase === 'failed';
  const phase = terminal || phaseOrder[proposedPhase] < phaseOrder[currentPhase] ? currentPhase : proposedPhase;
  return {
    ...current,
    ...proposed,
    phase,
    selectedDestinationCallControlId: current.selectedDestinationCallControlId || proposed.selectedDestinationCallControlId,
    destinationCallControlId: current.selectedDestinationCallControlId
      || proposed.selectedDestinationCallControlId
      || proposed.destinationCallControlId
      || current.destinationCallControlId,
    forkDestinationCallControlIds: [...new Set([
      ...(current.forkDestinationCallControlIds || []),
      ...(proposed.forkDestinationCallControlIds || []),
      current.destinationCallControlId,
      proposed.destinationCallControlId,
    ].filter(Boolean))],
    // Native bridge-on-answer is sticky. A later fork-initiated webhook must
    // not fall back to a second Vocivo bridge and hang up the winner.
    bridgeOnAnswer: current.bridgeOnAnswer === true || proposed.bridgeOnAnswer === true,
    // The copy read inside this transaction is authoritative. A stale webhook
    // may add call metadata, but it cannot roll a recorded hangup outcome back.
    termination: { ...(proposed.termination || {}), ...(current.termination || {}) },
    version: (current.version || 0) + 1,
    updatedAt: proposed.updatedAt || new Date().toISOString(),
  };
}

async function mutateOutboundCallPair(
  seed: OutboundCallPair,
  update: (current: OutboundCallPair) => OutboundCallPair | Promise<OutboundCallPair>,
) {
  const canonical = canonicalPath(seed);
  return transactObjectGroup(lockKey(seed), [canonical], async (objects) => {
    const stored = objects.get(canonical)?.body;
    const current = stored ? decrypt(stored) : null;
    const base = mergeOutboundCallPair(current, seed);
    const next = await update(base);
    const normalized = { ...next, version: Math.max(next.version || 0, (current?.version || 0) + 1) };
    const body = encrypt(normalized);
    const currentPaths = current ? pairPaths(current) : [];
    const nextPaths = pairPaths(normalized);
    return {
      puts: nextPaths.map((pathname) => ({
        pathname,
        value: body,
        options: { access: 'private' as const, contentType: 'application/octet-stream' },
      })),
      deletes: currentPaths.filter((pathname) => !nextPaths.includes(pathname)),
      result: normalized,
    };
  });
}

export async function saveOutboundCallPair(pair: OutboundCallPair) {
  return mutateOutboundCallPair(pair, (current) => current);
}

export async function updateOutboundCallPair(
  pair: OutboundCallPair,
  update: (current: OutboundCallPair) => OutboundCallPair | Promise<OutboundCallPair>,
) {
  return mutateOutboundCallPair(pair, update);
}

export async function claimOutboundCallWinner(pair: OutboundCallPair, destinationCallControlId: string) {
  let won = false;
  const updated = await mutateOutboundCallPair(pair, (current) => {
    if (current.phase === 'ended' || current.phase === 'failed') return current;
    const existing = current.selectedDestinationCallControlId;
    won = !existing || existing === destinationCallControlId;
    return won
      ? {
        ...current,
        selectedDestinationCallControlId: destinationCallControlId,
        destinationCallControlId,
        updatedAt: new Date().toISOString(),
      }
      : current;
  });
  return {
    won,
    pair: updated,
    loserIds: destinationIds(updated).filter((id) => id !== updated.selectedDestinationCallControlId),
  };
}

export function readOutboundCallPairByClient(id: string) { return readPath(path('client', id)); }
export function readOutboundCallPairByDestination(id: string) { return readPath(path('destination', id)); }
export function readOutboundCallPairByRoute(id: string) { return readPath(path('route', id)); }

export async function clearOutboundCallPair(pair: OutboundCallPair) {
  const canonical = canonicalPath(pair);
  await transactObjectGroup(lockKey(pair), [canonical], (objects) => {
    const stored = objects.get(canonical)?.body;
    const current = stored ? decrypt(stored) : pair;
    return { deletes: pairPaths(current), result: undefined };
  });
}
