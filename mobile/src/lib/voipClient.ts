import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import RNCallKeep, { CONSTANTS } from 'react-native-callkeep';
import InCallManager from 'react-native-incall-manager';
import RNVoipPushNotification from 'react-native-voip-push-notification';
import { registerGlobals } from 'react-native-webrtc';
import { Invitation, Inviter, Registerer, RegistererState, SessionState, UserAgent, Web, type Session } from 'sip.js';
import { api } from './api';

registerGlobals();

export enum TelnyxConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
}

export enum TelnyxCallState {
  NEW = 'NEW',
  CONNECTING = 'CONNECTING',
  RINGING = 'RINGING',
  ACTIVE = 'ACTIVE',
  HELD = 'HELD',
  ENDED = 'ENDED',
  FAILED = 'FAILED',
  DROPPED = 'DROPPED',
}

type Subscription = { unsubscribe: () => void };

class ValueStream<T> {
  #value: T;
  #listeners = new Set<(value: T) => void>();

  constructor(value: T) { this.#value = value; }
  get value() { return this.#value; }
  next(value: T) {
    this.#value = value;
    this.#listeners.forEach((listener) => listener(value));
  }
  subscribe(listener: (value: T) => void): Subscription {
    this.#listeners.add(listener);
    listener(this.#value);
    return { unsubscribe: () => this.#listeners.delete(listener) };
  }
}

export type CredentialConfig = {
  username: string;
  password: string;
  sipDomain: string;
  websocketUrl: string;
  extension?: string;
  displayName?: string;
  incomingCallRingtone?: string;
};

export function createCredentialConfig(username: string, password: string, options: Partial<CredentialConfig> = {}): CredentialConfig {
  return {
    username,
    password,
    sipDomain: options.sipDomain || '',
    websocketUrl: options.websocketUrl || '',
    extension: options.extension,
    displayName: options.displayName,
    incomingCallRingtone: options.incomingCallRingtone,
  };
}

type Header = { name: string; value: string };

function randomUuid() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requestHeader(session: Session, name: string) {
  try { return (session as Invitation).request?.getHeader?.(name) || ''; } catch { return ''; }
}

function visibleUser(session: Session) {
  return String(session.remoteIdentity.uri.user || 'Unknown caller');
}

function inviteHeaders(session: Session): Header[] {
  return ['X-Vocivo-Call-UUID', 'X-Vocivo-Caller-Extension', 'X-Vocivo-Caller-Name', 'X-Vocivo-Caller-Photo', 'X-Vocivo-Call-Type']
    .map((name) => ({ name, value: requestHeader(session, name) }))
    .filter((item) => item.value);
}

async function terminateSession(session: Session) {
  if (session.state === SessionState.Established) return session.bye();
  if (session instanceof Invitation && session.state === SessionState.Initial) return session.reject();
  if (session instanceof Inviter && [SessionState.Initial, SessionState.Establishing].includes(session.state)) return session.cancel();
}

const pendingPushes: Array<Record<string, unknown> & { receivedAt: number }> = [];
const pendingNativeActions = new Map<string, 'answer' | 'end'>();
const pushTokenKey = 'vocivo:apns-voip-token';
const deviceIdKey = 'vocivo:push-device-id';

function rememberPush(payload: object) {
  const value: Record<string, unknown> & { receivedAt: number } = { ...payload, receivedAt: Date.now() };
  pendingPushes.push(value);
  while (pendingPushes.length > 10) pendingPushes.shift();
  return value;
}

function takePush(callUuid?: string) {
  const freshAfter = Date.now() - 90_000;
  for (let index = pendingPushes.length - 1; index >= 0; index -= 1) {
    const value = pendingPushes[index];
    if (!value || value.receivedAt < freshAfter) {
      pendingPushes.splice(index, 1);
      continue;
    }
    if (callUuid && value.callUUID !== callUuid && value.callId !== callUuid && value.sessionId !== callUuid) continue;
    pendingPushes.splice(index, 1);
    return value;
  }
  return undefined;
}

function validCallUuid(value: unknown) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized) ? normalized : '';
}

export class Call {
  readonly session: Session;
  readonly callId: string;
  readonly isIncoming: boolean;
  readonly destination: string;
  readonly callerName: string;
  readonly callerNumber: string;
  readonly inviteCustomHeaders: Header[];
  readonly callState$: ValueStream<TelnyxCallState>;
  readonly isMuted$ = new ValueStream(false);
  readonly isHeld$ = new ValueStream(false);
  readonly duration$ = new ValueStream(0);
  #client: VocivoVoipClient;
  #durationTimer?: ReturnType<typeof setInterval>;
  #connectedAt?: number;

  constructor(client: VocivoVoipClient, session: Session, input: { incoming: boolean; callId?: string; destination?: string; callerName?: string; callerNumber?: string; headers?: Header[] }) {
    this.#client = client;
    this.session = session;
    this.callId = input.callId || randomUuid();
    this.isIncoming = input.incoming;
    this.destination = input.destination || visibleUser(session);
    this.callerName = input.callerName || session.remoteIdentity.displayName || visibleUser(session);
    this.callerNumber = input.callerNumber || visibleUser(session);
    this.inviteCustomHeaders = input.headers || inviteHeaders(session);
    this.callState$ = new ValueStream<TelnyxCallState>(input.incoming ? TelnyxCallState.RINGING : TelnyxCallState.CONNECTING);
    session.stateChange.addListener((nextState) => this.#stateChanged(nextState));
  }

  get currentState() { return this.callState$.value; }
  get currentIsMuted() { return this.isMuted$.value; }
  get currentIsHeld() { return this.isHeld$.value; }
  get currentDuration() { return this.duration$.value; }

  async answer() {
    if (!(this.session instanceof Invitation) || this.session.state !== SessionState.Initial) return;
    await this.session.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
  }

  async hangup() { await terminateSession(this.session); }

  async hold() {
    if (this.session.state !== SessionState.Established) throw new Error('The call is not connected.');
    await this.session.invite({ sessionDescriptionHandlerModifiers: [Web.holdModifier] });
    this.isHeld$.next(true);
    this.callState$.next(TelnyxCallState.HELD);
    this.#client.emitCalls();
  }

  async resume() {
    if (this.session.state !== SessionState.Established) throw new Error('The call is not connected.');
    await this.session.invite({ sessionDescriptionHandlerModifiers: [] });
    this.isHeld$.next(false);
    this.callState$.next(TelnyxCallState.ACTIVE);
    this.#client.emitCalls();
  }

  async toggleMute() {
    const handler = this.session.sessionDescriptionHandler as unknown as { localMediaStream?: MediaStream } | undefined;
    const next = !this.currentIsMuted;
    handler?.localMediaStream?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    InCallManager.setMicrophoneMute(next);
    this.isMuted$.next(next);
  }

  async dtmf(digit: string) {
    const handler = this.session.sessionDescriptionHandler as unknown as { sendDtmf?: (tones: string, options?: unknown) => boolean } | undefined;
    if (!handler?.sendDtmf?.(digit, { duration: 160, interToneGap: 70 })) throw new Error('The keypad tone could not be sent.');
  }

  async transfer(target: string) {
    const uri = UserAgent.makeURI(`sip:${target}@${this.#client.sipDomain}`);
    if (!uri || this.session.state !== SessionState.Established) throw new Error('The transfer destination is unavailable.');
    await this.session.refer(uri);
  }

  #stateChanged(state: SessionState) {
    if (state === SessionState.Establishing) {
      this.callState$.next(this.isIncoming ? TelnyxCallState.CONNECTING : TelnyxCallState.RINGING);
      this.#client.emitCalls();
      return;
    }
    if (state === SessionState.Established) {
      this.#connectedAt = Date.now();
      this.callState$.next(this.currentIsHeld ? TelnyxCallState.HELD : TelnyxCallState.ACTIVE);
      InCallManager.stopRingback();
      InCallManager.stopRingtone();
      InCallManager.start({ media: 'audio' });
      if (!this.isIncoming && Platform.OS === 'ios') RNCallKeep.reportConnectedOutgoingCallWithUUID(this.callId);
      this.#durationTimer ||= setInterval(() => this.duration$.next(Math.max(0, Math.floor((Date.now() - (this.#connectedAt || Date.now())) / 1000))), 1000);
      this.#client.emitCalls();
      return;
    }
    if (state === SessionState.Terminated) {
      if (this.#durationTimer) clearInterval(this.#durationTimer);
      this.#durationTimer = undefined;
      this.callState$.next(TelnyxCallState.ENDED);
      RNCallKeep.reportEndCallWithUUID(this.callId, CONSTANTS.END_CALL_REASONS.REMOTE_ENDED);
      this.#client.removeCall(this.callId);
    }
  }
}

export class VocivoVoipClient {
  readonly connectionState$ = new ValueStream(TelnyxConnectionState.DISCONNECTED);
  readonly calls$ = new ValueStream<Call[]>([]);
  readonly activeCall$ = new ValueStream<Call | null>(null);
  #userAgent?: UserAgent;
  #registerer?: Registerer;
  #calls = new Map<string, Call>();
  #config?: CredentialConfig;

  constructor() {
    RNCallKeep.setup({
      ios: { appName: 'Vocivo', supportsVideo: true, maximumCallGroups: '2', maximumCallsPerCallGroup: '5', ringtoneSound: 'vocivo_classic.wav', includesCallsInRecents: false },
      android: {
        alertTitle: 'Phone account permission',
        alertDescription: 'Vocivo needs calling permission to show incoming business calls.',
        cancelButton: 'Cancel',
        okButton: 'Allow',
        additionalPermissions: [],
        foregroundService: { channelId: 'vocivo-calls', channelName: 'Vocivo calls', notificationTitle: 'Vocivo call in progress', notificationIcon: 'ic_launcher' },
      },
    }).catch(() => undefined);
    RNCallKeep.addEventListener('answerCall', ({ callUUID }) => this.nativeAction(callUUID, 'answer'));
    RNCallKeep.addEventListener('endCall', ({ callUUID }) => this.nativeAction(callUUID, 'end'));
    RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ callUUID }) => this.getCall(callUUID)?.toggleMute().catch(() => undefined));
    RNCallKeep.addEventListener('didToggleHoldCallAction', ({ callUUID, hold }) => {
      const call = this.getCall(callUUID);
      if (call) (hold ? call.hold() : call.resume()).catch(() => undefined);
    });
    RNCallKeep.addEventListener('didPerformDTMFAction', ({ callUUID, digits }) => this.getCall(callUUID)?.dtmf(digits).catch(() => undefined));
    if (Platform.OS === 'ios') {
      RNVoipPushNotification.addEventListener('register', (token) => AsyncStorage.setItem(pushTokenKey, token).catch(() => undefined));
      RNVoipPushNotification.addEventListener('notification', (payload) => {
        const push = rememberPush(payload);
        const uuid = String(push.callUUID || '');
        if (uuid) RNVoipPushNotification.onVoipNotificationCompleted(uuid);
      });
      RNVoipPushNotification.addEventListener('didLoadWithEvents', (events) => {
        events.forEach((event) => {
          if (event.name === RNVoipPushNotification.RNVoipPushRemoteNotificationsRegisteredEvent) AsyncStorage.setItem(pushTokenKey, String(event.data)).catch(() => undefined);
          if (event.name === RNVoipPushNotification.RNVoipPushRemoteNotificationReceivedEvent && event.data && typeof event.data === 'object') rememberPush(event.data);
        });
      });
      RNVoipPushNotification.registerVoipToken();
    }
  }

  get currentConnectionState() { return this.connectionState$.value; }
  get currentCalls() { return [...this.#calls.values()]; }
  get currentActiveCall() { return this.activeCall$.value; }
  get sipDomain() { return this.#config?.sipDomain || ''; }

  async login(config: CredentialConfig) {
    if (!config.username || !config.password || !config.sipDomain || !config.websocketUrl) throw new Error('Vocivo returned incomplete SIP credentials.');
    if (this.#userAgent && this.#config?.username === config.username && this.currentConnectionState === TelnyxConnectionState.CONNECTED) return;
    await this.logout();
    this.#config = config;
    this.connectionState$.next(TelnyxConnectionState.CONNECTING);
    const uri = UserAgent.makeURI(`sip:${config.username}@${config.sipDomain}`);
    if (!uri) throw new Error('The extension SIP address is invalid.');
    const userAgent = new UserAgent({
      uri,
      displayName: config.displayName || config.extension || config.username,
      authorizationUsername: config.username,
      authorizationPassword: config.password,
      transportOptions: { server: config.websocketUrl, connectionTimeout: 12, keepAliveInterval: 25, traceSip: false },
      reconnectionAttempts: 20,
      reconnectionDelay: 3,
      noAnswerTimeout: 60,
      logBuiltinEnabled: __DEV__,
      sessionDescriptionHandlerFactoryOptions: { peerConnectionConfiguration: { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] } },
      delegate: { onInvite: (invitation) => this.receiveInvite(invitation) },
    });
    const registerer = new Registerer(userAgent, { expires: 300 });
    registerer.stateChange.addListener((state) => {
      this.connectionState$.next(state === RegistererState.Registered ? TelnyxConnectionState.CONNECTED : TelnyxConnectionState.CONNECTING);
    });
    this.#userAgent = userAgent;
    this.#registerer = registerer;
    await userAgent.start();
    await registerer.register();
  }

  async logout() {
    for (const call of this.currentCalls) await call.hangup().catch(() => undefined);
    await this.#registerer?.unregister().catch(() => undefined);
    await this.#userAgent?.stop().catch(() => undefined);
    this.#registerer = undefined;
    this.#userAgent = undefined;
    this.#calls.clear();
    this.calls$.next([]);
    this.activeCall$.next(null);
    this.connectionState$.next(TelnyxConnectionState.DISCONNECTED);
    InCallManager.stop();
  }

  async newCall(destination: string, callerName: string, _callerNumber?: string, headers: Header[] = []) {
    if (!this.#userAgent || !this.#config || this.currentConnectionState !== TelnyxConnectionState.CONNECTED) throw new Error('Call service is still connecting.');
    const user = destination.match(/^sip:([^@]+)/i)?.[1] || destination;
    const target = UserAgent.makeURI(`sip:${user}@${this.#config.sipDomain}`);
    if (!target) throw new Error('The destination is invalid.');
    const inviter = new Inviter(this.#userAgent, target, {
      params: { fromDisplayName: callerName },
      extraHeaders: headers.map((item) => `${item.name}: ${item.value}`),
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
    });
    const call = new Call(this, inviter, { incoming: false, destination: user, callerName, callerNumber: user, headers });
    this.addCall(call, true);
    RNCallKeep.startCall(call.callId, user, callerName, 'generic', false);
    if (Platform.OS === 'ios') RNCallKeep.reportConnectingOutgoingCallWithUUID(call.callId);
    InCallManager.start({ media: 'audio', ringback: '_DEFAULT_' });
    await inviter.invite();
    return call;
  }

  getCall(id: string) { return this.#calls.get(id); }

  setActiveCall(id: string) {
    const call = this.#calls.get(id);
    if (call) this.activeCall$.next(call);
  }

  async swapCalls(targetId: string) {
    const current = this.currentActiveCall;
    const target = this.getCall(targetId);
    if (!current || !target) throw new Error('Both calls are required for swapping.');
    await current.hold();
    await target.resume();
    this.setActiveCall(target.callId);
  }

  enablePushNotifications() {}
  disablePushNotifications() {}

  emitCalls() { this.calls$.next(this.currentCalls); }

  removeCall(id: string) {
    this.#calls.delete(id);
    this.emitCalls();
    if (this.currentActiveCall?.callId === id) {
      const remaining = this.currentCalls.find((call) => ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)) || null;
      this.activeCall$.next(remaining);
    }
    if (!this.#calls.size) InCallManager.stop();
  }

  private addCall(call: Call, active: boolean) {
    this.#calls.set(call.callId, call);
    this.emitCalls();
    if (active) this.activeCall$.next(call);
    const action = pendingNativeActions.get(call.callId);
    if (action) {
      pendingNativeActions.delete(call.callId);
      this.nativeAction(call.callId, action);
    }
  }

  private receiveInvite(invitation: Invitation) {
    const headerCallUuid = validCallUuid(requestHeader(invitation, 'X-Vocivo-Call-UUID'));
    const push = takePush(headerCallUuid);
    const callId = validCallUuid(push?.callUUID) || headerCallUuid || randomUuid();
    const callerName = typeof push?.callerName === 'string' ? push.callerName : invitation.remoteIdentity.displayName || visibleUser(invitation);
    const callerNumber = typeof push?.callerNumber === 'string' ? push.callerNumber : visibleUser(invitation);
    const call = new Call(this, invitation, { incoming: true, callId, destination: this.#config?.extension || this.#config?.username, callerName, callerNumber });
    this.addCall(call, !this.currentActiveCall);
    if (!push) RNCallKeep.displayIncomingCall(call.callId, callerNumber, callerName, 'generic', false, { organizationName: 'Vocivo' });
  }

  private nativeAction(callId: string, action: 'answer' | 'end') {
    const call = this.getCall(callId);
    if (!call) { pendingNativeActions.set(callId, action); return; }
    if (action === 'answer') {
      this.setActiveCall(callId);
      call.answer().catch(() => RNCallKeep.endCall(callId));
      return;
    }
    call.hangup().catch(() => undefined);
  }
}

export const voipClient = new VocivoVoipClient();

export const TelnyxVoipClient = {
  isLaunchedFromPushNotification: async () => false,
};

export const VoicePnBridge = {
  getVoipToken: async () => AsyncStorage.getItem(pushTokenKey),
  endCall: async (id: string) => { RNCallKeep.endCall(id); return true; },
  hideIncomingCallNotification: async () => true,
  toggleSpeaker: async () => {
    const next = !(VoicePnBridge as { speaker?: boolean }).speaker;
    (VoicePnBridge as { speaker?: boolean }).speaker = next;
    InCallManager.setForceSpeakerphoneOn(next);
    return next;
  },
  setIncomingCallRingtone: async (ringtone: string) => {
    RNCallKeep.setSettings({
      ios: { appName: 'Vocivo', supportsVideo: true, maximumCallGroups: '2', maximumCallsPerCallGroup: '5', ringtoneSound: `${ringtone}.wav`, includesCallsInRecents: false },
      android: { alertTitle: 'Phone account permission', alertDescription: 'Vocivo needs calling permission.', cancelButton: 'Cancel', okButton: 'Allow', additionalPermissions: [] },
    });
    return true;
  },
};

export async function pushDeviceId() {
  const existing = await AsyncStorage.getItem(deviceIdKey);
  if (existing) return existing;
  const value = randomUuid();
  await AsyncStorage.setItem(deviceIdKey, value);
  return value;
}

export async function signOutVoiceDevice() {
  voipClient.disablePushNotifications();
  const id = await pushDeviceId();
  await api.delete(`/api/voice/devices?deviceId=${encodeURIComponent(id)}`).catch(() => undefined);
  await voipClient.logout().catch(() => undefined);
}
