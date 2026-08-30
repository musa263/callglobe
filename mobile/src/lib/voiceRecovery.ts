import type { Call } from '@telnyx/react-voice-commons-sdk';

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

export function peerConnectionForCall(call: Call | null): PeerConnectionLike | null {
  const nativeCall = call?.telnyxCall as unknown as NativeCallLike | undefined;
  return nativeCall?.peer?.getPeerConnection?.() || null;
}

export function isTransportNetworkMigration(previous: string | null, current: string) {
  const transports = new Set(['wifi', 'cellular']);
  return Boolean(previous && previous !== current && transports.has(previous) && transports.has(current));
}

export function attachIceFailureListener(call: Call, recover: (reason: string) => void) {
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

export function isBidirectionalMediaReady(call: Call | null) {
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

export async function hasConfirmedBidirectionalMedia(call: Call | null) {
  if (!isBidirectionalMediaReady(call)) return false;
  const peer = peerConnectionForCall(call);
  // ICE + live tracks are not enough: Telnyx can report ACTIVE (SIP 200)
  // before the first audible RTP packet. Missing getStats must not start the timer.
  if (!peer?.getStats) return false;
  const records = statRecords(await peer.getStats());
  const isAudio = (record: Record<string, unknown>) => !record.kind || record.kind === 'audio' || record.mediaType === 'audio';
  const outbound = records.some((record) => record.type === 'outbound-rtp' && isAudio(record)
    && (Number(record.packetsSent || 0) > 0 || Number(record.bytesSent || 0) > 0));
  const inbound = records.some((record) => record.type === 'inbound-rtp' && isAudio(record)
    && (Number(record.packetsReceived || 0) > 0 || Number(record.bytesReceived || 0) > 0));
  return outbound && inbound;
}

const TRACKS_ONLY_HOLD_MS = 1_200;

export async function waitForBidirectionalMedia(call: Call, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  let tracksReadySince: number | null = null;
  while (Date.now() < deadline) {
    if (await hasConfirmedBidirectionalMedia(call)) return true;
    if (isBidirectionalMediaReady(call)) {
      tracksReadySince ??= Date.now();
      const peer = peerConnectionForCall(call);
      if (!peer?.getStats && Date.now() - tracksReadySince >= TRACKS_ONLY_HOLD_MS) return true;
    } else {
      tracksReadySince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return hasConfirmedBidirectionalMedia(call);
}

export class VoiceMediaRecoveryCoordinator {
  private operation: Promise<void> | null = null;
  private lastAttemptAt = 0;

  constructor(
    private readonly reportError: (operation: string, error: unknown) => void,
    private readonly recoveryDelayMs = 1_250,
  ) {}

  recover(call: Call | null, reason: string) {
    if (!call) return Promise.resolve();
    if (this.operation) return this.operation;
    const now = Date.now();
    if (now - this.lastAttemptAt < 1_000) return Promise.resolve();
    this.lastAttemptAt = now;
    this.operation = (async () => {
      const peer = peerConnectionForCall(call);
      const nativeCall = call.telnyxCall as unknown as NativeCallLike;
      if (!peer?.restartIce) throw new Error('The active call does not expose ICE restart support.');
      try {
        // The patched Telnyx SDK method creates a fresh local offer and sends
        // it through Telnyx's supported attach/re-INVITE signaling path.
        if (nativeCall.restartMedia) {
          await nativeCall.restartMedia();
        } else {
          peer.restartIce();
          const offer = await peer.createOffer?.({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: false });
          if (!offer || !peer.setLocalDescription) throw new Error('Telnyx media renegotiation is unavailable.');
          await peer.setLocalDescription(offer);
          throw new Error('A new ICE offer was created but the SDK cannot transmit a media re-INVITE.');
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
    })().finally(() => { this.operation = null; });
    return this.operation;
  }
}
