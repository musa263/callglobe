/**
 * Media recovery, for whichever engine is carrying the call.
 *
 * The peer connection is reached structurally rather than through the carrier
 * SDK's `Call`: Vocivo's own SIP engine exposes one directly, and the carrier's
 * is behind `telnyxCall.peer`. Everything past that point is the same WebRTC.
 */
export type RecoverableCall = {
  readonly callId: string;
  /** Vocivo's SIP engine hands its peer connection over directly. */
  peerConnection?: unknown;
  /** The carrier SDK keeps its own behind a native wrapper. */
  telnyxCall?: unknown;
  restartMedia?: () => Promise<void>;
};

export type StoredVoiceSession = {
  token: string;
  expiresAt: number;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
};

type PeerConnectionLike = {
  connectionState?: string;
  iceConnectionState?: string;
  restartIce?: () => void;
  createOffer?: (options?: { iceRestart?: boolean; offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean }) => Promise<unknown>;
  setLocalDescription?: (description: unknown) => Promise<void>;
  getStats?: () => Promise<unknown>;
  getSenders?: () => Array<{ track?: { kind?: string; enabled?: boolean; readyState?: string } | null }>;
  getReceivers?: () => Array<{ track?: { kind?: string; enabled?: boolean; readyState?: string } | null }>;
  addEventListener?: (event: 'iceconnectionstatechange', listener: () => void) => void;
  removeEventListener?: (event: 'iceconnectionstatechange', listener: () => void) => void;
};

type NativeCallLike = {
  peer?: { getPeerConnection?: () => PeerConnectionLike | null };
  restartMedia?: () => Promise<void>;
};

export function isVoiceSessionFresh(session: StoredVoiceSession | null, minimumValidityMs = 120_000): session is StoredVoiceSession {
  return Boolean(session?.token && session.expiresAt > Date.now() + minimumValidityMs);
}

export function peerConnectionForCall(call: RecoverableCall | null): PeerConnectionLike | null {
  if (call?.peerConnection) return call.peerConnection as PeerConnectionLike;
  const nativeCall = call?.telnyxCall as NativeCallLike | undefined;
  return nativeCall?.peer?.getPeerConnection?.() || null;
}

export function isTransportNetworkMigration(previous: string | null, current: string) {
  const transports = new Set(['wifi', 'cellular']);
  return Boolean(previous && previous !== current && transports.has(previous) && transports.has(current));
}

export function attachIceFailureListener(call: RecoverableCall, recover: (reason: string) => void) {
  const peer = peerConnectionForCall(call);
  if (!peer?.addEventListener || !peer.removeEventListener) return null;
  let disconnectedTimer: ReturnType<typeof setTimeout> | undefined;
  const listener = () => {
    const state = String(peer.iceConnectionState || '').toLowerCase();
    if (state === 'failed') {
      if (disconnectedTimer) clearTimeout(disconnectedTimer);
      recover('ice-failed');
      return;
    }
    if (state === 'disconnected') {
      if (disconnectedTimer) clearTimeout(disconnectedTimer);
      disconnectedTimer = setTimeout(() => recover('ice-disconnected'), 1_500);
      return;
    }
    if (disconnectedTimer && ['connected', 'completed', 'closed'].includes(state)) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = undefined;
    }
  };
  peer.addEventListener('iceconnectionstatechange', listener);
  return () => {
    if (disconnectedTimer) clearTimeout(disconnectedTimer);
    peer.removeEventListener?.('iceconnectionstatechange', listener);
  };
}

export function isBidirectionalMediaReady(call: RecoverableCall | null) {
  const peer = peerConnectionForCall(call);
  if (!peer) return false;
  const connectionState = String(peer.connectionState || '').toLowerCase();
  const iceState = String(peer.iceConnectionState || '').toLowerCase();
  const senders = peer.getSenders?.() ?? [];
  const receivers = peer.getReceivers?.() ?? [];
  const hasLiveAudioSender = senders.some(({ track }) => track?.kind === 'audio' && track.enabled !== false && track.readyState !== 'ended');
  const hasLiveAudioReceiver = receivers.some(({ track }) => track?.kind === 'audio' && track.readyState !== 'ended');
  return ['connected', 'completed'].includes(iceState)
    && (!connectionState || connectionState === 'connected')
    && hasLiveAudioSender
    && hasLiveAudioReceiver;
}

function statRecords(report: unknown): Array<Record<string, unknown>> {
  if (!report) return [];
  if (report instanceof Map) return Array.from(report.values()) as Array<Record<string, unknown>>;
  if (Array.isArray(report)) return report as Array<Record<string, unknown>>;
  if (typeof report === 'object') {
    const candidate = report as { forEach?: (listener: (value: Record<string, unknown>) => void) => void };
    if (typeof candidate.forEach === 'function') {
      const values: Array<Record<string, unknown>> = [];
      candidate.forEach((value) => values.push(value));
      return values;
    }
    return Object.values(report as Record<string, Record<string, unknown>>);
  }
  return [];
}

export type AudioRtpCounts = { inbound: number; outbound: number };

const MIN_CONVERSATION_RTP_PACKETS = 12;

function isAudioStat(record: Record<string, unknown>) {
  return !record.kind || record.kind === 'audio' || record.mediaType === 'audio';
}

export async function readAudioRtpCounts(call: RecoverableCall | null): Promise<AudioRtpCounts | null> {
  const peer = peerConnectionForCall(call);
  if (!peer?.getStats) return null;
  const records = statRecords(await peer.getStats());
  let inbound = 0;
  let outbound = 0;
  for (const record of records) {
    if (!isAudioStat(record)) continue;
    if (record.type === 'inbound-rtp') inbound += Number(record.packetsReceived || 0);
    if (record.type === 'outbound-rtp') outbound += Number(record.packetsSent || 0);
  }
  return { inbound, outbound };
}

export function hasConversationRtpProgress(current: AudioRtpCounts | null, baseline: AudioRtpCounts | null) {
  if (!current) return false;
  const inboundDelta = current.inbound - (baseline?.inbound ?? 0);
  const outboundDelta = current.outbound - (baseline?.outbound ?? 0);
  return inboundDelta >= MIN_CONVERSATION_RTP_PACKETS && outboundDelta >= MIN_CONVERSATION_RTP_PACKETS;
}

export async function hasConfirmedBidirectionalMedia(call: RecoverableCall | null, baseline: AudioRtpCounts | null = null) {
  if (!isBidirectionalMediaReady(call)) return false;
  // ICE + live tracks are not enough: Telnyx can report ACTIVE (SIP 200)
  // and ringback RTP before the first audible conversation packet.
  return hasConversationRtpProgress(await readAudioRtpCounts(call), baseline);
}

export function isSetupSignalingBlip(sdkLiveCallCount: number, uiCallId?: string) {
  return sdkLiveCallCount === 0 && !uiCallId;
}

export async function waitForBidirectionalMedia(call: RecoverableCall, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  const baseline = await readAudioRtpCounts(call);
  while (Date.now() < deadline) {
    if (await hasConfirmedBidirectionalMedia(call, baseline)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return hasConfirmedBidirectionalMedia(call, baseline);
}

export class VoiceMediaRecoveryCoordinator {
  private operations = new Map<string, Promise<void>>();
  private lastAttemptAt = new Map<string, number>();

  constructor(
    private readonly reportError: (operation: string, error: unknown) => void,
    private readonly recoveryDelayMs = 1_250,
  ) {}

  recover(call: RecoverableCall | null, reason: string) {
    if (!call) return Promise.resolve();
    const callId = call.callId;
    const inFlight = this.operations.get(callId);
    if (inFlight) return inFlight;
    const now = Date.now();
    if (now - (this.lastAttemptAt.get(callId) ?? 0) < 1_000) return Promise.resolve();
    this.lastAttemptAt.set(callId, now);
    const operation = (async () => {
      const peer = peerConnectionForCall(call);
      const nativeCall = call.telnyxCall as NativeCallLike | undefined;
      if (!peer?.restartIce) throw new Error('The active call does not expose ICE restart support.');
      try {
        // The patched Telnyx SDK method creates a fresh local offer and sends
        // it through Telnyx's supported attach/re-INVITE signaling path.
        if (call.restartMedia) {
          await call.restartMedia();
        } else if (nativeCall?.restartMedia) {
          await nativeCall.restartMedia();
        } else {
          // Without the patched restartMedia there is no supported way to send
          // the re-INVITE; fail before touching the peer connection's SDP.
          throw new Error('Telnyx media renegotiation is unavailable: the SDK cannot transmit a media re-INVITE.');
        }
      } catch (error) {
        this.reportError(`${reason}:media-renegotiation`, error);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, this.recoveryDelayMs));
      const iceState = String(peerConnectionForCall(call)?.iceConnectionState || '').toLowerCase();
      if (['connected', 'completed'].includes(iceState)) return;
      const pending = new Error(`ICE remained ${iceState || 'unknown'} after restart`);
      this.reportError(`${reason}:ice-pending`, pending);
      throw pending;
    })().finally(() => { this.operations.delete(callId); });
    this.operations.set(callId, operation);
    return operation;
  }
}
