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
    // The real SDK's enums are uppercase (models/call-state.d.ts). They were
    // mocked lowercase here, which the app never noticed because it compared
    // against these same mocked values.
    TelnyxCallState: {
      RINGING: 'RINGING', CONNECTING: 'CONNECTING', ACTIVE: 'ACTIVE', HELD: 'HELD',
      ENDED: 'ENDED', FAILED: 'FAILED', DROPPED: 'DROPPED',
    },
    TelnyxConnectionState: {
      CONNECTED: 'CONNECTED', DISCONNECTED: 'DISCONNECTED', ERROR: 'ERROR',
      CONNECTING: 'CONNECTING', RECONNECTING: 'RECONNECTING',
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

jest.mock('../../src/shared/api', () => ({
  api: { get: jest.fn(), post: jest.fn(async () => ({ token: 'test-token', expires_in: 3600 })) },
}));

jest.mock('../../src/features/calling/runtime/routeCancellation', () => ({
  routeCancellations: { cancel: jest.fn(async () => undefined), flush: jest.fn(async () => undefined) },
}));

jest.mock('../../src/features/calling/media/ringtone', () => ({
  applyIncomingRingtone: jest.fn(async () => undefined),
  loadIncomingRingtone: jest.fn(async () => 'system'),
}));

jest.mock('../../src/features/auth/AuthContext', () => {
  const auth = {
    loading: false,
    isAuthenticated: false,
    addHistory: jest.fn(),
    profile: null,
  };
  return { useAuth: () => auth, __authState: auth };
});

jest.mock('../../src/features/calling/runtime/voipClient', () => {
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

  const connectionState$ = new TestSubject('CONNECTED');
  const calls$ = new TestSubject([]);
  const activeCall$ = new TestSubject(null);
  const state = { calls: [] as any[], active: null as any };
  const voipClient: any = {
    connectionState$, calls$, activeCall$,
    get currentConnectionState() { return 'CONNECTED'; },
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
    // The real module re-exports this from the SDK; engines.ts reads it here.
    VoicePnBridge: {
      endCall: jest.fn(async () => true),
      hideIncomingCallNotification: jest.fn(async () => true),
      toggleSpeaker: jest.fn(async () => true),
    },
    getVoicePushToken: jest.fn(async () => undefined),
    loadVoiceSession: jest.fn(async () => null),
    persistVoiceSession: jest.fn(async () => undefined),
  };
});

import { TelnyxConnectionState, TelnyxVoipClient, VoicePnBridge } from '@telnyx/react-voice-commons-sdk';
import NetInfo from '@react-native-community/netinfo';
import { VoiceProvider, VoiceRoot, useVoice } from '../../src/features/calling/VoiceContext';
import { loadVoiceSession, persistVoiceSession, voipClient } from '../../src/features/calling/runtime/voipClient';
import { voice } from '../../src/features/calling/engine/voiceClientFacade';
import { SipEventBus, SipStackBridge } from '../../src/features/calling/engine/sipBridge';
import { SipVoiceClient } from '../../src/features/calling/engine/sipCallEngine';
import { routeCancellations } from '../../src/features/calling/runtime/routeCancellation';
import type { SipSessionHandle, SipSessionState } from '../../src/features/calling/engine/sipStack';

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
  const callState$ = immediateSubject('ACTIVE');
  let packets = 0;
  const call = {
    callId: 'mounted-active-call',
    currentState: 'ACTIVE',
    currentDuration: 0,
    currentIsMuted: false,
    currentIsHeld: false,
    isIncoming: true,
    callerName: 'Mousa',
    callerNumber: '2000',
    destination: '2000',
    inviteCustomHeaders: [],
    hangup: jest.fn(async () => undefined),
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

  // In the app this is what useVoiceRegistration does once /api/voice/config
  // has said which edge serves this tenant. The test stands in for it so the
  // context has an engine to talk to.
  voice.use('telnyx', voipClient as any, {
    toggleSpeaker: async () => false,
    endNativeCall: async (callId: string) => { await VoicePnBridge.endCall(callId); },
    hideIncomingCallUi: async () => {},
  });

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
  expect(call.hangup).toHaveBeenCalledTimes(1);

  await act(async () => tree!.unmount());
  expect(callState$.subscriberCount).toBe(0);
  // The context lets go of the client it talks to...
  expect(voice.connectionState$.observerCount).toBe(0);
  // ...and the client lets go of the engine underneath it.
  voice.detach();
  expect((voipClient as any).connectionState$.subscriberCount).toBe(0);
});

test('mounted SIP provider disposes media and engine calls on fatal transport loss even if BYE fails', async () => {
  const events = new SipEventBus();
  let stateListener: ((state: SipSessionState) => void) | undefined;
  const track = { stopped: false };
  const handle: SipSessionHandle = {
    id: 'sip-live-call', incoming: false, remoteDisplayName: 'Colleague', remoteUser: '2001', remoteTarget: 'sip:2001@example.test', headers: [],
    disposition: () => ({}), peerConnection: () => null,
    onStateChange: listener => { stateListener = listener; },
    accept: async () => {}, terminate: async () => { throw new Error('socket unavailable'); },
    dispose: async () => { track.stopped = true; throw new Error('BYE transport failure'); },
    setHold: async () => {}, setMuted: async () => {}, sendDtmf: async () => {},
  };
  const bridge = new SipStackBridge({ events, createStack: () => ({
    onRegistrationChange: () => {}, onInvitation: () => {}, start: async () => {}, stop: async () => {},
    refresh: async () => {}, invite: async () => handle, setSpeaker: async () => {},
  }) });
  const client = new SipVoiceClient({ events, bridge });
  const nativeEnd = jest.fn(async () => {});
  voice.use('sip', client, { endNativeCall: nativeEnd, toggleSpeaker: async () => false, hideIncomingCallUi: async () => {} });
  const observed: { current: ReturnType<typeof useVoice> | null } = { current: null };
  function Probe() { observed.current = useVoice(); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await act(async () => {
      tree = TestRenderer.create(<VoiceProvider><Probe /></VoiceProvider>);
    });
    await act(async () => {
      await bridge.register({ username: 'employee', password: 'test-only', domain: 'example.test' });
      events.emit('registration', { state: 'ok' });
      await client.newCall('2001', 'Colleague', undefined, [{ name: 'X-Vocivo-Route-ID', value: 'test-route-12345678' }]);
      stateListener?.('Established');
    });
    expect(observed.current?.activeCall).not.toBeNull();
    await act(async () => { events.emit('registration', { state: 'failed' }); });
    expect(track.stopped).toBe(true);
    expect(client.currentCalls).toEqual([]);
    expect(bridge.peerConnection(handle.id)).toBeUndefined();
    expect(observed.current?.activeCall).toBeNull();
    expect(observed.current?.duration).toBe(0);
    expect(nativeEnd).toHaveBeenCalledWith(handle.id);
    expect(routeCancellations.cancel).toHaveBeenCalledWith('test-route-12345678');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('dispose call after transport loss'), expect.anything());
    await act(async () => {
      stateListener?.('Established');
      events.emit('registration', { state: 'ok' });
    });
    expect(client.currentCalls).toEqual([]);
    expect(observed.current?.activeCall).toBeNull();
  } finally {
    await act(async () => { tree?.unmount(); });
    voice.detach(); client.dispose(); errors.mockRestore();
  }
});

test('killed-state native push bootstraps a fresh secure voice session before HTTP auth completes', async () => {
  const authState = (require('../../src/features/auth/AuthContext') as any).__authState;
  authState.loading = true;
  authState.isAuthenticated = false;
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
});
