import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));

jest.mock('@react-native-community/netinfo', () => {
  let listener: ((state: unknown) => void) | null = null;
  return {
    __esModule: true,
    default: {
      addEventListener: jest.fn((next: (state: unknown) => void) => { listener = next; return () => { listener = null; }; }),
      __emit: (state: unknown) => listener?.(state),
    },
  };
});

jest.mock('@telnyx/react-voice-commons-sdk', () => {
  const React = require('react');
  return {
    TelnyxCallState: {
      RINGING: 'ringing', CONNECTING: 'connecting', ACTIVE: 'active', HELD: 'held',
      ENDED: 'ended', FAILED: 'failed', DROPPED: 'dropped',
    },
    TelnyxConnectionState: {
      CONNECTED: 'connected', DISCONNECTED: 'disconnected', ERROR: 'error', CONNECTING: 'connecting',
    },
    createTokenConfig: jest.fn((token, options) => ({ type: 'token', token, ...options })),
    TelnyxVoipClient: { isLaunchedFromPushNotification: jest.fn(async () => false) },
    TelnyxVoiceApp: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    VoicePnBridge: {
      endCall: jest.fn(async () => true),
      hideIncomingCallNotification: jest.fn(async () => true),
      toggleSpeaker: jest.fn(async () => true),
    },
  };
});

jest.mock('../../src/lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(async () => ({ token: 'test-token', expires_in: 3600 })) },
}));

jest.mock('../../src/lib/ringtone', () => ({
  applyIncomingRingtone: jest.fn(async () => undefined),
  loadIncomingRingtone: jest.fn(async () => 'system'),
}));

jest.mock('../../src/context/AuthContext', () => {
  const auth = {
    loading: false,
    isAuthenticated: false,
    isPreview: true,
    addHistory: jest.fn(),
    profile: null,
  };
  return { useAuth: () => auth, __authState: auth };
});

jest.mock('../../src/lib/voipClient', () => {
  class TestSubject {
    private listeners = new Set<any>();
    private currentValue: unknown;
    constructor(initialValue: unknown) { this.currentValue = initialValue; }
    subscribe(listener: (nextValue: unknown) => void) {
      this.listeners.add(listener);
      listener(this.currentValue);
      return { unsubscribe: () => this.listeners.delete(listener) };
    }
    next(nextValue: unknown) {
      this.currentValue = nextValue;
      this.listeners.forEach((listener) => listener(nextValue));
    }
    get subscriberCount() { return this.listeners.size; }
  }

  const connectionState$ = new TestSubject('connected');
  const calls$ = new TestSubject([]);
  const activeCall$ = new TestSubject(null);
  const state = { calls: [] as any[], active: null as any };
  const voipClient: any = {
    connectionState$, calls$, activeCall$,
    get currentConnectionState() { return 'connected'; },
    get currentCalls() { return state.calls; },
    get currentActiveCall() { return state.active; },
    getCall: jest.fn((id: string) => state.calls.find((call) => call.callId === id)),
    setActiveCall: jest.fn(),
    logout: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
    __emitCall(call: any) {
      state.calls = call ? [call] : [];
      state.active = call;
      calls$.next(state.calls);
      activeCall$.next(call);
    },
  };

  return {
    voipClient,
    getVoicePushToken: jest.fn(async () => undefined),
    loadVoiceSession: jest.fn(async () => null),
    persistVoiceSession: jest.fn(async () => undefined),
  };
});

jest.mock('../../src/lib/sipJsClient', () => ({
  setSipIncomingHandler: jest.fn(),
  sipSessionId: jest.fn(() => ''),
  SessionState: { Initial: 'Initial', Establishing: 'Establishing', Established: 'Established', Terminating: 'Terminating', Terminated: 'Terminated' },
}));

jest.mock('../../src/lib/sipNative', () => ({
  answerVocivoSip: jest.fn(),
  hangupVocivoSip: jest.fn(),
  inviteVocivoSip: jest.fn(),
  mergeVocivoSip: jest.fn(),
  onVocivoSipReady: jest.fn(() => () => undefined),
  registerVocivoSip: jest.fn(async () => undefined),
  unregisterVocivoSip: jest.fn(async () => undefined),
  setPreferredVoiceEdge: jest.fn(),
  preferredVoiceEdge: jest.fn(() => 'telnyx'),
  referVocivoSip: jest.fn(),
  sendVocivoSipDtmf: jest.fn(),
  setVocivoSipHeld: jest.fn(),
  setVocivoSipMuted: jest.fn(),
  sipClientReady: jest.fn(() => false),
  sipDomain: jest.fn(() => ''),
  sipEdgeInternalCallsOnly: jest.fn(() => false),
  subscribeVocivoSipEvents: jest.fn(() => () => undefined),
  swapVocivoSip: jest.fn(),
}));

import { TelnyxConnectionState, TelnyxVoipClient, VoicePnBridge } from '@telnyx/react-voice-commons-sdk';
import NetInfo from '@react-native-community/netinfo';
import { VoiceProvider, VoiceRoot, useVoice } from '../../src/context/VoiceContext';
import { loadVoiceSession, persistVoiceSession, voipClient } from '../../src/lib/voipClient';

function immediateSubject<T>(initial: T) {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      listener(initial);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    get subscriberCount() { return listeners.size; },
  };
}

test('mounted VoiceProvider confirms already-active media and tears down on transport loss', async () => {
  const observed: { current: ReturnType<typeof useVoice> | null } = { current: null };
  const callState$ = immediateSubject('active');
  let packets = 0;
  const call = {
    callId: 'mounted-active-call',
    currentState: 'active',
    currentDuration: 0,
    currentIsMuted: false,
    currentIsHeld: false,
    isIncoming: true,
    callerName: 'Mousa',
    callerNumber: '2000',
    destination: '2000',
    inviteCustomHeaders: [],
    callState$,
    isMuted$: immediateSubject(false),
    isHeld$: immediateSubject(false),
    telnyxCall: {
      restartMedia: jest.fn(async () => undefined),
      peer: {
        getPeerConnection: () => ({
          connectionState: 'connected',
          iceConnectionState: 'connected',
          getSenders: () => [{ track: { kind: 'audio', enabled: true, readyState: 'live' } }],
          getReceivers: () => [{ track: { kind: 'audio', readyState: 'live' } }],
          getStats: async () => {
            packets += 16;
            return new Map([
              ['out', { type: 'outbound-rtp', kind: 'audio', packetsSent: packets }],
              ['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: packets }],
            ]);
          },
          restartIce: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        }),
      },
    },
  };

  function Probe() {
    observed.current = useVoice();
    return null;
  }

  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VoiceProvider><Probe /></VoiceProvider>);
  });
  await act(async () => {
    const mediaReadyStartedAt = Date.now();
    (voipClient as any).__emitCall(call);
    await Promise.resolve();
    expect(Date.now() - mediaReadyStartedAt).toBeLessThan(450);
  });

  if (!observed.current) throw new Error('VoiceContext did not mount.');
  expect(observed.current.activeCall?.phase).toBe('active');
  expect(observed.current.activeCall?.connectedAt).toEqual(expect.any(Number));

  await act(async () => {
    (NetInfo as any).__emit({ type: 'wifi', isConnected: true });
    (NetInfo as any).__emit({ type: 'cellular', isConnected: true });
    (voipClient as any).connectionState$.next(TelnyxConnectionState.DISCONNECTED);
  });
  expect(observed.current.activeCall?.id).toBe('mounted-active-call');

  await act(async () => {
    (voipClient as any).connectionState$.next(TelnyxConnectionState.CONNECTED);
    await Promise.resolve();
  });
  expect(call.telnyxCall.restartMedia).toHaveBeenCalled();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_300)); });

  await act(async () => {
    (voipClient as any).connectionState$.next(TelnyxConnectionState.DISCONNECTED);
  });
  expect(observed.current.activeCall).toBeNull();
  expect(VoicePnBridge.endCall).toHaveBeenCalledWith('mounted-active-call');

  await act(async () => tree!.unmount());
  expect(callState$.subscriberCount).toBe(0);
  expect((voipClient as any).connectionState$.subscriberCount).toBe(0);
});

test('killed-state native push bootstraps a fresh secure voice session before HTTP auth completes', async () => {
  const authState = (require('../../src/context/AuthContext') as any).__authState;
  authState.loading = true;
  authState.isAuthenticated = false;
  authState.isPreview = false;
  const freshSession = {
    token: 'cached-push-token',
    expiresAt: Date.now() + 10 * 60_000,
    iceServers: [{ urls: 'turns:turn.example.test:443', username: 'ephemeral', credential: 'ephemeral' }],
  };
  (TelnyxVoipClient.isLaunchedFromPushNotification as jest.Mock).mockResolvedValueOnce(true);
  (loadVoiceSession as jest.Mock).mockResolvedValueOnce(freshSession);

  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VoiceRoot><React.Fragment /></VoiceRoot>);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(loadVoiceSession).toHaveBeenCalled();
  expect(persistVoiceSession).toHaveBeenCalledWith(expect.objectContaining({
    token: freshSession.token,
    iceServers: freshSession.iceServers,
  }));

  await act(async () => tree!.unmount());
  authState.loading = false;
  authState.isAuthenticated = false;
  authState.isPreview = true;
});
