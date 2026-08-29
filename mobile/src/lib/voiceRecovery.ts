import type { Call } from '@telnyx/react-voice-commons-sdk';

export type StoredVoiceSession = {
  token: string;
  expiresAt: number;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
};

type PeerConnectionLike = {
  iceConnectionState?: string;
  restartIce?: () => void;
  addEventListener?: (event: 'iceconnectionstatechange', listener: () => void) => void;
  removeEventListener?: (event: 'iceconnectionstatechange', listener: () => void) => void;
};

type NativeCallLike = {
  peer?: { getPeerConnection?: () => PeerConnectionLike | null };
};

export function isVoiceSessionFresh(session: StoredVoiceSession | null, minimumValidityMs = 120_000): session is StoredVoiceSession {
  return Boolean(session?.token && session.expiresAt > Date.now() + minimumValidityMs);
}

export function peerConnectionForCall(call: Call | null): PeerConnectionLike | null {
  const nativeCall = call?.telnyxCall as unknown as NativeCallLike | undefined;
  return nativeCall?.peer?.getPeerConnection?.() || null;
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

export class VoiceMediaRecoveryCoordinator {
  private operation: Promise<void> | null = null;
  private lastAttemptAt = 0;

  constructor(
    private readonly reconnectSignaling: () => Promise<boolean>,
    private readonly reportError: (operation: string, error: unknown) => void,
    private readonly signalingDelayMs = 1_750,
  ) {}

  recover(call: Call | null, reason: string) {
    if (!call) return Promise.resolve();
    if (this.operation) return this.operation;
    const now = Date.now();
    if (now - this.lastAttemptAt < 1_000) return Promise.resolve();
    this.lastAttemptAt = now;
    this.operation = (async () => {
      const peer = peerConnectionForCall(call);
      try {
        peer?.restartIce?.();
      } catch (error) {
        this.reportError(`${reason}:restart-ice`, error);
      }

      // The native Telnyx client owns the SIP attach/re-INVITE lifecycle. Wait
      // briefly for its NetInfo handler, then request one serialized reattach if
      // ICE is still failed or disconnected.
      await new Promise((resolve) => setTimeout(resolve, this.signalingDelayMs));
      const iceState = String(peerConnectionForCall(call)?.iceConnectionState || '').toLowerCase();
      if (['connected', 'completed'].includes(iceState)) return;
      try {
        await this.reconnectSignaling();
      } catch (error) {
        this.reportError(`${reason}:signaling-reattach`, error);
        throw error;
      }
    })().finally(() => { this.operation = null; });
    return this.operation;
  }
}
