import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceSubject } from './observable';
import { VoiceClientFacade } from './voiceClientFacade';
import type { VoiceCall, VoiceClient, VoiceConnectionState } from './voiceEngine';

function fakeCall(callId: string): VoiceCall {
  return {
    callId,
    isIncoming: false,
    callerName: '',
    callerNumber: '',
    destination: '1002',
    inviteCustomHeaders: [],
    currentState: 'ACTIVE',
    currentIsMuted: false,
    currentIsHeld: false,
    currentDuration: 0,
    callState$: new VoiceSubject('ACTIVE' as const),
    isMuted$: new VoiceSubject(false),
    isHeld$: new VoiceSubject(false),
    answer: async () => {},
    hangup: async () => {},
    hold: async () => {},
    resume: async () => {},
    toggleMute: async () => {},
    dtmf: async () => {},
  };
}

const ids = (calls: VoiceCall[]) => calls.map((call) => call.callId);

function fakeEngine(initial: VoiceConnectionState = 'DISCONNECTED') {
  const connectionState$ = new VoiceSubject<VoiceConnectionState>(initial);
  const calls$ = new VoiceSubject<VoiceCall[]>([]);
  const activeCall$ = new VoiceSubject<VoiceCall | null>(null);
  const seen: string[] = [];
  const engine: VoiceClient = {
    connectionState$,
    calls$,
    activeCall$,
    get currentConnectionState() { return connectionState$.value; },
    get currentCalls() { return calls$.value; },
    get currentActiveCall() { return activeCall$.value; },
    newCall: async (destination) => { seen.push(`newCall:${destination}`); return fakeCall('out-1'); },
    getCall: (callId) => { seen.push(`getCall:${callId}`); return undefined; },
    setActiveCall: (callId) => { seen.push(`setActiveCall:${callId}`); },
    logout: async () => { seen.push('logout'); },
  };
  return { engine, connectionState$, calls$, activeCall$, seen };
}

test('a subscription taken before an engine exists still sees the engine when it arrives', () => {
  const facade = new VoiceClientFacade();
  const states: VoiceConnectionState[] = [];
  // This is the whole point: VoiceContext subscribes on mount, and which engine
  // serves the call is only known once /api/voice/config has answered.
  facade.connectionState$.subscribe((state) => states.push(state));

  const telnyx = fakeEngine('CONNECTED');
  facade.use('telnyx', telnyx.engine);
  assert.deepEqual(states, ['DISCONNECTED', 'CONNECTED']);
  assert.equal(facade.currentConnectionState, 'CONNECTED');
  assert.equal(facade.currentEngine, 'telnyx');
});

test('swapping engines is invisible to a subscriber', () => {
  const facade = new VoiceClientFacade();
  const states: VoiceConnectionState[] = [];
  facade.connectionState$.subscribe((state) => states.push(state));

  const telnyx = fakeEngine('CONNECTED');
  facade.use('telnyx', telnyx.engine);
  const sip = fakeEngine('CONNECTING');
  facade.use('sip', sip.engine);
  sip.connectionState$.next('CONNECTED');

  assert.deepEqual(states, ['DISCONNECTED', 'CONNECTED', 'CONNECTING', 'CONNECTED']);
  assert.equal(facade.currentEngine, 'sip');
});

test('the engine that was replaced can no longer drive the UI', () => {
  const facade = new VoiceClientFacade();
  const telnyx = fakeEngine('CONNECTED');
  facade.use('telnyx', telnyx.engine);
  const sip = fakeEngine('CONNECTED');
  facade.use('sip', sip.engine);

  // A carrier socket that comes back after the swap must not put a call on
  // screen, or the user answers a call the app is no longer on.
  telnyx.calls$.next([fakeCall('ghost')]);
  assert.deepEqual(ids(facade.currentCalls), []);

  sip.calls$.next([fakeCall('real')]);
  assert.deepEqual(ids(facade.currentCalls), ['real']);
});

test('calls and the active call are forwarded', () => {
  const facade = new VoiceClientFacade();
  const engine = fakeEngine('CONNECTED');
  facade.use('sip', engine.engine);
  const call = fakeCall('c1');
  engine.calls$.next([call]);
  engine.activeCall$.next(call);
  assert.equal(facade.currentActiveCall?.callId, 'c1');
  assert.equal(facade.currentCalls.length, 1);
});

test('everything else is delegated to the installed engine', async () => {
  const facade = new VoiceClientFacade();
  const engine = fakeEngine();
  facade.use('sip', engine.engine);
  await facade.newCall('1002', 'Sam', '+15551230000', []);
  facade.getCall('c1');
  facade.setActiveCall('c1');
  await facade.logout();
  assert.deepEqual(engine.seen, ['newCall:1002', 'getCall:c1', 'setActiveCall:c1', 'logout']);
});

test('placing a call before an engine is chosen fails with something a user can read', async () => {
  const facade = new VoiceClientFacade();
  await assert.rejects(() => facade.newCall('1002', 'Sam', undefined, []), /still starting up/);
});

test('signing out before an engine is chosen is not an error', async () => {
  const facade = new VoiceClientFacade();
  await facade.logout();
  facade.setActiveCall('c1');
  assert.equal(facade.getCall('c1'), undefined);
});

test('detaching clears the call state rather than leaving it on screen', () => {
  const facade = new VoiceClientFacade();
  const engine = fakeEngine('CONNECTED');
  facade.use('sip', engine.engine);
  engine.calls$.next([fakeCall('c1')]);
  engine.activeCall$.next(fakeCall('c1'));

  facade.detach();
  assert.deepEqual(ids(facade.currentCalls), []);
  assert.equal(facade.currentActiveCall, null);
  assert.equal(facade.currentConnectionState, 'DISCONNECTED');
  assert.equal(facade.currentEngine, null);

  // And the detached engine cannot bring it back.
  engine.calls$.next([fakeCall('c2')]);
  assert.deepEqual(ids(facade.currentCalls), []);
});

test('re-installing the same engine does not double-forward', () => {
  const facade = new VoiceClientFacade();
  const engine = fakeEngine('CONNECTED');
  facade.use('sip', engine.engine);
  facade.use('sip', engine.engine);
  const states: VoiceConnectionState[] = [];
  facade.connectionState$.subscribe((state) => states.push(state));
  engine.connectionState$.next('RECONNECTING');
  assert.deepEqual(states, ['CONNECTED', 'RECONNECTING']);
});

test('the speaker route follows the engine', async () => {
  const facade = new VoiceClientFacade();
  let on = false;
  facade.use('sip', fakeEngine().engine, {
    toggleSpeaker: async () => { on = !on; return on; },
    endNativeCall: async () => {},
    hideIncomingCallUi: async () => {},
  });
  assert.equal(await facade.toggleSpeaker(), true);
  assert.equal(await facade.toggleSpeaker(), false);
});

test('an engine with no speaker control reports the earpiece rather than throwing', async () => {
  const facade = new VoiceClientFacade();
  facade.use('sip', fakeEngine().engine);
  assert.equal(await facade.toggleSpeaker(), false);
});
