import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import RNCallKeep, { CONSTANTS } from 'react-native-callkeep';
import InCallManager from 'react-native-incall-manager';
import RNVoipPushNotification from 'react-native-voip-push-notification';
import { registerGlobals, RTCAudioSession } from 'react-native-webrtc';
import { Invitation, Inviter, Registerer, RegistererState, SessionState, UserAgent, Web, type Session } from 'sip.js';
import { api } from './api';
import { canTransitionCallState, SerialTaskQueue, SingleFlightTermination } from './callLifecycle';
import { ProxyAwareSipTransport, registerAndWait } from './sipTransport';
import {
  BackgroundWakeCoordinator,
  CallTerminationLedger,
  DisposableScope,
  logTelephonyError,
  NetworkMigrationCoordinator,
  nativeCallEndAction,
  settleTelephony,
  type CallTerminationReason,
} from './voipRuntime';

registerGlobals();

const outgoingAnswerTimeoutMs = 35_000;

type RemoteMessage = FirebaseMessagingTypes.RemoteMessage;
type FirebaseMessagingModule = typeof import('@react-native-firebase/messaging');
let firebaseMessagingModule: FirebaseMessagingModule | undefined;

function androidMessaging() {
  if (Platform.OS !== 'android') throw new Error('Firebase messaging is only configured on Android.');
  firebaseMessagingModule ||= require('@react-native-firebase/messaging') as FirebaseMessagingModule;
  return firebaseMessagingModule;
}

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
  clear() { this.#listeners.clear(); }
}

export type CredentialConfig = {
  username: string;
  password: string;
  sipDomain: string;
  websocketUrl: string;
  extension?: string;
  displayName?: string;
  incomingCallRingtone?: string;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
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
    iceServers: options.iceServers,
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
  try {
    return (session as Invitation).request?.getHeader?.(name) || '';
  } catch (error) {
    logTelephonyError('read-sip-header', error, { header: name });
    return '';
  }
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
  if (session instanceof Invitation && session.state !== SessionState.Terminated) {
    return session.reject({ statusCode: 486, reasonPhrase: 'Busy Here' });
  }
  if (session instanceof Inviter && [SessionState.Initial, SessionState.Establishing].includes(session.state)) return session.cancel();
}

const pendingPushes: Array<Record<string, unknown> & { receivedAt: number }> = [];
const pendingNativeActions = new Map<string, { action: 'answer' | 'end'; timer: ReturnType<typeof setTimeout> }>();
const pushTokenKey = 'vocivo:apns-voip-token';
const deviceIdKey = 'vocivo:push-device-id';
const voiceSignedInKey = 'vocivo:voice-signed-in';
const voiceCredentialKey = 'vocivo:sip-credentials-v1';
const androidForegroundService = {
  channelId: 'vocivo-calls',
  channelName: 'Vocivo calls',
  notificationTitle: 'Vocivo call in progress',
  notificationIcon: 'ic_launcher',
};

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

function booleanValue(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function incomingPushPayload(message: RemoteMessage | { data?: Record<string, string | undefined> }) {
  const data = message.data || {};
  if (data.type !== 'incoming_call' || data.schema !== 'vocivo.push.call.v1') return null;
  const callUUID = validCallUuid(data.callUUID);
  if (!callUUID) return null;
  return {
    ...data,
    callUUID,
    callerName: String(data.callerName || 'Unknown caller').slice(0, 160),
    callerNumber: String(data.callerNumber || data.extension || 'private').slice(0, 160),
    organizationName: String(data.organizationName || 'Vocivo').slice(0, 160),
    hasVideo: booleanValue(data.hasVideo),
  };
}

type IncomingPushPayload = NonNullable<ReturnType<typeof incomingPushPayload>>;

function stringPushData(data: RemoteMessage['data']) {
  return Object.fromEntries(
    Object.entries(data || {}).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []),
  ) as Record<string, string>;
}

async function persistCredentialConfig(config: CredentialConfig) {
  await SecureStore.setItemAsync(voiceCredentialKey, JSON.stringify(config), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function readCredentialConfig() {
  const value = await SecureStore.getItemAsync(voiceCredentialKey);
  if (!value) return undefined;
  try {
    const config = JSON.parse(value) as CredentialConfig;
    return config.username && config.password && config.sipDomain && config.websocketUrl ? config : undefined;
  } catch (error) {
    logTelephonyError('read-persisted-sip-credentials', error);
    return undefined;
  }
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
  #noAnswerTimer?: ReturnType<typeof setTimeout>;
  #connectedAt?: number;
  #answerPromise?: Promise<void>;
  #termination = new SingleFlightTermination();
  #terminationLedger = new CallTerminationLedger();
  #reinviteQueue = new SerialTaskQueue();
  #lastIceRestartAt = 0;
  #lifecycle = new DisposableScope();
  #waiters = new Set<(error: Error) => void>();
  #disposed = false;
  #nativeAlreadyEnded = false;

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
    const stateListener = (nextState: SessionState) => this.#stateChanged(nextState);
    session.stateChange.addListener(stateListener);
    this.#lifecycle.add(() => session.stateChange.removeListener(stateListener));
    if (!input.incoming) {
      this.#noAnswerTimer = setTimeout(() => {
        if (![SessionState.Initial, SessionState.Establishing].includes(this.session.state)) return;
        void settleTelephony('outgoing-no-answer-timeout', this.hangup('unanswered'), { callId: this.callId });
      }, outgoingAnswerTimeoutMs);
    }
  }

  get currentState() { return this.callState$.value; }
  get currentIsMuted() { return this.isMuted$.value; }
  get currentIsHeld() { return this.isHeld$.value; }
  get currentDuration() { return this.duration$.value; }
  get terminationRequested() { return this.#termination.requested; }
  get terminationReason() { return this.#terminationLedger.reason; }

  #transition(next: TelnyxCallState) {
    if (!canTransitionCallState(this.currentState, next, this.#termination.requested)) return false;
    this.callState$.next(next);
    this.#client.emitCalls();
    return true;
  }

  async answer() {
    if (this.#disposed || this.#termination.requested || this.#terminationLedger.finished) throw new Error('The call has already ended.');
    if (!(this.session instanceof Invitation) || this.session.state !== SessionState.Initial) return;
    this.#answerPromise ||= this.session.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } })
      .finally(() => { this.#answerPromise = undefined; });
    await this.#answerPromise;
  }

  async hangup(reason: CallTerminationReason = 'local_ended', nativeAlreadyEnded = false) {
    this.#terminationLedger.request(reason);
    this.#nativeAlreadyEnded ||= nativeAlreadyEnded;
    return this.#termination.run(async () => {
      if (this.#noAnswerTimer) clearTimeout(this.#noAnswerTimer);
      this.#noAnswerTimer = undefined;
      InCallManager.stopRingback();
      InCallManager.stopRingtone();
      this.#transition(TelnyxCallState.ENDED);
      try {
        await terminateSession(this.session);
      } finally {
        this.#client.completeCall(this.callId, this.#terminationLedger.finish(reason), this.#nativeAlreadyEnded);
      }
    });
  }

  markRinging() {
    if (this.isIncoming || this.currentState !== TelnyxCallState.CONNECTING) return;
    if (!this.#transition(TelnyxCallState.RINGING)) return;
    InCallManager.startRingback('_DEFAULT_');
  }

  async hold() {
    return this.#reinviteQueue.run(async () => {
      if (this.#termination.requested || this.session.state !== SessionState.Established) throw new Error('The call is not connected.');
      await this.session.invite({ sessionDescriptionHandlerModifiers: [Web.holdModifier] });
      this.isHeld$.next(true);
      this.#transition(TelnyxCallState.HELD);
    });
  }

  async resume() {
    return this.#reinviteQueue.run(async () => {
      if (this.#termination.requested || this.session.state !== SessionState.Established) throw new Error('The call is not connected.');
      await this.session.invite({ sessionDescriptionHandlerModifiers: [] });
      this.isHeld$.next(false);
      this.#transition(TelnyxCallState.ACTIVE);
    });
  }

  async restartIce() {
    const requestedAt = Date.now();
    if (requestedAt - this.#lastIceRestartAt < 1_500) return false;
    this.#lastIceRestartAt = requestedAt;
    return this.#reinviteQueue.run(async () => {
      if (this.#termination.requested || this.session.state !== SessionState.Established) return false;
      const handler = this.session.sessionDescriptionHandler as unknown as {
        peerConnection?: { restartIce?: () => void };
      } | undefined;
      handler?.peerConnection?.restartIce?.();
      const sessionDescriptionHandlerOptions: Web.SessionDescriptionHandlerOptions = {
        constraints: { audio: true, video: false },
        offerOptions: { iceRestart: true },
        iceGatheringTimeout: 6_000,
      };
      await this.session.invite({
        sessionDescriptionHandlerOptions,
        sessionDescriptionHandlerModifiers: this.currentIsHeld ? [Web.holdModifier] : [],
      });
      return true;
    });
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

  async waitUntilConnected(timeoutMs = 10_000) {
    if (this.#disposed) throw new Error('The call has already ended.');
    if (this.session.state === SessionState.Established) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const listener = (state: SessionState) => {
        if (state === SessionState.Established) finish();
        if (state === SessionState.Terminated) finish(new Error('The call ended before it connected.'));
      };
      const timer = setTimeout(() => finish(new Error('The call did not connect in time.')), timeoutMs);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.session.stateChange.removeListener(listener);
        this.#waiters.delete(cancel);
        error ? reject(error) : resolve();
      };
      const cancel = (error: Error) => finish(error);
      this.#waiters.add(cancel);
      this.session.stateChange.addListener(listener);
    });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#noAnswerTimer) clearTimeout(this.#noAnswerTimer);
    if (this.#durationTimer) clearInterval(this.#durationTimer);
    this.#noAnswerTimer = undefined;
    this.#durationTimer = undefined;
    this.#waiters.forEach((cancel) => cancel(new Error('The call was disposed before the operation completed.')));
    this.#waiters.clear();
    this.#lifecycle.dispose();
    this.callState$.clear();
    this.isMuted$.clear();
    this.isHeld$.clear();
    this.duration$.clear();
  }

  #stateChanged(state: SessionState) {
    if (state === SessionState.Establishing) {
      if (this.isIncoming) this.#transition(TelnyxCallState.CONNECTING);
      return;
    }
    if (state === SessionState.Established) {
      if (this.#noAnswerTimer) clearTimeout(this.#noAnswerTimer);
      this.#noAnswerTimer = undefined;
      this.#connectedAt = Date.now();
      if (!this.#transition(this.currentIsHeld ? TelnyxCallState.HELD : TelnyxCallState.ACTIVE)) return;
      InCallManager.stopRingback();
      InCallManager.stopRingtone();
      InCallManager.start({ media: 'audio' });
      const handler = this.session.sessionDescriptionHandler as unknown as { localMediaStream?: MediaStream; remoteMediaStream?: MediaStream } | undefined;
      handler?.localMediaStream?.getAudioTracks().forEach((track) => { track.enabled = true; });
      handler?.remoteMediaStream?.getAudioTracks().forEach((track) => { track.enabled = true; });
      if (Platform.OS === 'android') RNCallKeep.setCurrentCallActive(this.callId);
      if (!this.isIncoming && Platform.OS === 'ios') RNCallKeep.reportConnectedOutgoingCallWithUUID(this.callId);
      this.#durationTimer ||= setInterval(() => this.duration$.next(Math.max(0, Math.floor((Date.now() - (this.#connectedAt || Date.now())) / 1000))), 1000);
      return;
    }
    if (state === SessionState.Terminated) {
      if (this.#noAnswerTimer) clearTimeout(this.#noAnswerTimer);
      this.#noAnswerTimer = undefined;
      if (this.#durationTimer) clearInterval(this.#durationTimer);
      this.#durationTimer = undefined;
      InCallManager.stopRingback();
      InCallManager.stopRingtone();
      this.#transition(TelnyxCallState.ENDED);
      const reason = this.#terminationLedger.finish('remote_ended');
      this.#termination.finish();
      this.#client.completeCall(this.callId, reason, this.#nativeAlreadyEnded);
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
  #loginPromise?: Promise<void>;
  #callKeepReady: Promise<void>;
  #terminalCalls = new Map<string, number>();
  #nativeEndedCalls = new Set<string>();
  #nativeEndTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #callActionQueue = new SerialTaskQueue();
  #platformListeners?: DisposableScope;
  #sipListeners?: DisposableScope;
  #backgroundWake: BackgroundWakeCoordinator<IncomingPushPayload>;
  #networkMigration: NetworkMigrationCoordinator;

  constructor() {
    this.#callKeepReady = RNCallKeep.setup({
      ios: { appName: 'Vocivo', supportsVideo: true, maximumCallGroups: '2', maximumCallsPerCallGroup: '5', ringtoneSound: 'vocivo_classic.wav', includesCallsInRecents: true },
      android: {
        alertTitle: 'Phone account permission',
        alertDescription: 'Vocivo needs calling permission to show incoming business calls.',
        cancelButton: 'Cancel',
        okButton: 'Allow',
        additionalPermissions: [],
        foregroundService: androidForegroundService,
      },
    }).then(() => undefined);
    this.#backgroundWake = new BackgroundWakeCoordinator<IncomingPushPayload>({
      display: async (payload) => {
        rememberPush(payload);
        if (Platform.OS !== 'android' || this.#calls.has(payload.callUUID)) return;
        await this.#callKeepReady;
        await RNCallKeep.displayIncomingCall(
          payload.callUUID,
          payload.callerNumber,
          payload.callerName,
          'generic',
          payload.hasVideo,
          payload,
        );
      },
      complete: (payload) => {
        if (Platform.OS === 'ios') RNVoipPushNotification.onVoipNotificationCompleted(payload.callUUID);
      },
      wake: async () => {
        if (this.currentConnectionState === TelnyxConnectionState.CONNECTED) return;
        const config = this.#config || await readCredentialConfig();
        if (config) await this.login(config);
      },
    });
    this.#networkMigration = new NetworkMigrationCoordinator(
      () => this.restartIce(),
      async () => { await this.refreshRegistration(); },
    );
    this.#ensurePlatformListeners();
  }

  get currentConnectionState() { return this.connectionState$.value; }
  get currentCalls() { return [...this.#calls.values()]; }
  get currentActiveCall() { return this.activeCall$.value; }
  get sipDomain() { return this.#config?.sipDomain || ''; }

  #ensurePlatformListeners() {
    if (this.#platformListeners && !this.#platformListeners.disposed) return;
    const scope = new DisposableScope();
    this.#platformListeners = scope;
    const callKeepListener = <T extends Parameters<typeof RNCallKeep.addEventListener>[0]>(
      event: T,
      listener: Parameters<typeof RNCallKeep.addEventListener<T>>[1],
    ) => {
      const subscription = RNCallKeep.addEventListener(event, listener);
      scope.add(() => subscription.remove());
    };

    callKeepListener('answerCall', ({ callUUID }) => this.nativeAction(callUUID, 'answer'));
    callKeepListener('endCall', ({ callUUID }) => this.nativeAction(callUUID, 'end'));
    callKeepListener('didPerformSetMutedCallAction', ({ callUUID }) => {
      const call = this.getCall(callUUID);
      if (call) void settleTelephony('callkeep-toggle-mute', call.toggleMute(), { callId: callUUID });
    });
    callKeepListener('didToggleHoldCallAction', ({ callUUID, hold }) => {
      const call = this.getCall(callUUID);
      if (call) void settleTelephony(hold ? 'callkeep-hold' : 'callkeep-resume', hold ? call.hold() : call.resume(), { callId: callUUID });
    });
    callKeepListener('didPerformDTMFAction', ({ callUUID, digits }) => {
      const call = this.getCall(callUUID);
      if (call) void settleTelephony('callkeep-dtmf', call.dtmf(digits), { callId: callUUID, digits });
    });
    callKeepListener('didActivateAudioSession', () => {
      try {
        RTCAudioSession.audioSessionDidActivate();
        InCallManager.start({ media: 'audio' });
      } catch (error) {
        logTelephonyError('activate-native-audio-session', error);
      }
    });
    callKeepListener('didDeactivateAudioSession', () => {
      try {
        RTCAudioSession.audioSessionDidDeactivate();
        if (!this.currentCalls.some((call) => call.currentState === TelnyxCallState.ACTIVE)) InCallManager.stop();
      } catch (error) {
        logTelephonyError('deactivate-native-audio-session', error);
      }
    });

    if (Platform.OS === 'ios') {
      RNVoipPushNotification.addEventListener('register', (token) => {
        void settleTelephony('persist-ios-push-token', AsyncStorage.setItem(pushTokenKey, token));
      });
      scope.add(() => RNVoipPushNotification.removeEventListener('register'));
      RNVoipPushNotification.addEventListener('notification', (payload) => {
        const data = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)]));
        void settleTelephony('ios-pushkit-background-wake', this.wakeForIncomingPush(data));
      });
      scope.add(() => RNVoipPushNotification.removeEventListener('notification'));
      RNVoipPushNotification.addEventListener('didLoadWithEvents', (events) => {
        events.forEach((event) => {
          if (event.name === RNVoipPushNotification.RNVoipPushRemoteNotificationsRegisteredEvent) {
            void settleTelephony('persist-cold-start-ios-push-token', AsyncStorage.setItem(pushTokenKey, String(event.data)));
          }
          if (event.name === RNVoipPushNotification.RNVoipPushRemoteNotificationReceivedEvent && event.data && typeof event.data === 'object') {
            const data = Object.fromEntries(Object.entries(event.data).map(([key, value]) => [key, String(value)]));
            void settleTelephony('ios-cold-start-push-wake', this.wakeForIncomingPush(data));
          }
        });
      });
      scope.add(() => RNVoipPushNotification.removeEventListener('didLoadWithEvents'));
      RNVoipPushNotification.registerVoipToken();
    }

    if (Platform.OS === 'android') {
      try {
        const { getMessaging, onMessage } = androidMessaging();
        scope.add(onMessage(getMessaging(), handleAndroidRemoteMessage));
      } catch (error) {
        logTelephonyError('register-android-foreground-push-listener', error);
      }
    }

    void this.#callKeepReady.then(async () => {
      if (this.#platformListeners !== scope || scope.disposed) return;
      if (Platform.OS === 'android') RNCallKeep.setForegroundServiceSettings(androidForegroundService);
      const events = await RNCallKeep.getInitialEvents();
      if (this.#platformListeners !== scope || scope.disposed) return;
      events.forEach((event) => {
        if (event.name === 'RNCallKeepPerformAnswerCallAction') this.nativeAction(event.data.callUUID, 'answer');
        if (event.name === 'RNCallKeepPerformEndCallAction') this.nativeAction(event.data.callUUID, 'end');
      });
      RNCallKeep.clearInitialEvents();
    }).catch((error) => logTelephonyError('load-callkeep-initial-events', error));
  }

  #disposePlatformListeners() {
    this.#platformListeners?.dispose();
    this.#platformListeners = undefined;
  }

  #rememberTerminalCall(callId: string) {
    const now = Date.now();
    for (const [id, expiresAt] of this.#terminalCalls) if (expiresAt <= now) this.#terminalCalls.delete(id);
    this.#terminalCalls.set(callId, now + 5 * 60_000);
  }

  #isTerminalCall(callId: string) {
    const expiresAt = this.#terminalCalls.get(callId) || 0;
    if (expiresAt > Date.now()) return true;
    this.#terminalCalls.delete(callId);
    return false;
  }

  #finishNativeCall(callId: string, reason: CallTerminationReason, nativeAlreadyEnded = false) {
    if (this.#nativeEndedCalls.has(callId)) return;
    this.#nativeEndedCalls.add(callId);
    const action = nativeCallEndAction(reason, nativeAlreadyEnded);
    if (action === 'end') RNCallKeep.endCall(callId);
    if (action === 'reject') RNCallKeep.rejectCall(callId);
    if (action === 'report_remote') RNCallKeep.reportEndCallWithUUID(callId, CONSTANTS.END_CALL_REASONS.REMOTE_ENDED);
    if (action === 'report_unanswered') RNCallKeep.reportEndCallWithUUID(callId, CONSTANTS.END_CALL_REASONS.UNANSWERED);
    if (action === 'report_failed') RNCallKeep.reportEndCallWithUUID(callId, CONSTANTS.END_CALL_REASONS.FAILED);
    if (action === 'report_missed') RNCallKeep.reportEndCallWithUUID(callId, CONSTANTS.END_CALL_REASONS.MISSED);
    const timer = setTimeout(() => {
      this.#nativeEndedCalls.delete(callId);
      this.#nativeEndTimers.delete(callId);
    }, 5 * 60_000);
    this.#nativeEndTimers.set(callId, timer);
  }

  completeCall(callId: string, reason: CallTerminationReason, nativeAlreadyEnded = false) {
    if (this.#isTerminalCall(callId)) return;
    this.#rememberTerminalCall(callId);
    const pending = pendingNativeActions.get(callId);
    if (pending) clearTimeout(pending.timer);
    pendingNativeActions.delete(callId);
    this.#finishNativeCall(callId, reason, nativeAlreadyEnded);
    this.removeCall(callId);
  }

  async endCall(callId: string, options: { nativeAlreadyEnded?: boolean; reason?: CallTerminationReason } = {}) {
    if (!callId || this.#isTerminalCall(callId)) return;
    const nativeAlreadyEnded = Boolean(options.nativeAlreadyEnded);
    const reason = options.reason || 'local_ended';
    const call = this.getCall(callId);
    if (!call) {
      this.#rememberTerminalCall(callId);
      this.#finishNativeCall(callId, reason, nativeAlreadyEnded);
      return;
    }
    await call.hangup(reason, nativeAlreadyEnded);
  }

  async restartIce() {
    const calls = this.currentCalls.filter((call) => call.session.state === SessionState.Established && !call.terminationRequested);
    if (!calls.length) return false;
    const results = await Promise.allSettled(calls.map((call) => call.restartIce()));
    return results.some((result) => result.status === 'fulfilled' && result.value);
  }

  handleNetworkRoute(route: string) {
    return this.#networkMigration.observe(route);
  }

  async receiveRemotePush(data: Record<string, string | undefined>) {
    const payload = incomingPushPayload({ data });
    if (!payload || this.#isTerminalCall(payload.callUUID)) return false;
    this.#ensurePlatformListeners();
    return this.#backgroundWake.handle(payload);
  }

  async wakeForIncomingPush(data: Record<string, string | undefined>) {
    return this.receiveRemotePush(data);
  }

  async refreshRegistration() {
    const registerer = this.#registerer;
    const userAgent = this.#userAgent;
    if (!registerer || !userAgent) throw new Error('Calling service is not initialized.');
    this.connectionState$.next(TelnyxConnectionState.CONNECTING);
    try {
      await registerAndWait(registerer);
      if (this.#registerer === registerer && this.#userAgent === userAgent) {
        this.connectionState$.next(TelnyxConnectionState.CONNECTED);
        if (Platform.OS === 'android') RNCallKeep.setAvailable(true);
      }
    } catch (error) {
      if (this.#registerer === registerer && this.#userAgent === userAgent) {
        this.connectionState$.next(TelnyxConnectionState.DISCONNECTED);
      }
      throw error;
    }
  }

  async login(config: CredentialConfig) {
    if (!config.username || !config.password || !config.sipDomain || !config.websocketUrl) throw new Error('Vocivo returned incomplete SIP credentials.');
    this.#ensurePlatformListeners();
    await persistCredentialConfig(config);
    const sameRegistration = Boolean(
      this.#userAgent
      && this.#config?.username === config.username
      && this.#config?.sipDomain === config.sipDomain
      && this.#config?.websocketUrl === config.websocketUrl,
    );
    if (sameRegistration && this.currentConnectionState === TelnyxConnectionState.CONNECTED) return;
    if (sameRegistration && this.currentCalls.length) {
      // Never rebuild the SIP user agent during a media handoff: performLogin()
      // calls logout(), which would send BYE/CANCEL for every active session.
      await this.refreshRegistration();
      return;
    }
    if (this.#loginPromise) return this.#loginPromise;
    this.#loginPromise = this.performLogin(config).finally(() => { this.#loginPromise = undefined; });
    return this.#loginPromise;
  }

  async reconnect() {
    this.#ensurePlatformListeners();
    if (this.currentCalls.length) return;
    const config = this.#config;
    if (!config) throw new Error('Calling service is not initialized.');
    if (this.#loginPromise) return this.#loginPromise;
    this.#loginPromise = this.performLogin(config).finally(() => { this.#loginPromise = undefined; });
    return this.#loginPromise;
  }

  private async performLogin(config: CredentialConfig) {
    await this.#teardownSipRegistration();
    this.#config = config;
    this.connectionState$.next(TelnyxConnectionState.CONNECTING);
    const uri = UserAgent.makeURI(`sip:${config.username}@${config.sipDomain}`);
    if (!uri) throw new Error('The extension SIP address is invalid.');
    const userAgent = new UserAgent({
      uri,
      displayName: config.displayName || config.extension || config.username,
      authorizationUsername: config.username,
      authorizationPassword: config.password,
      transportConstructor: ProxyAwareSipTransport,
      transportOptions: { server: config.websocketUrl, connectionTimeout: 12, keepAliveInterval: 25, traceSip: false },
      reconnectionAttempts: 20,
      reconnectionDelay: 3,
      noAnswerTimeout: 60,
      logBuiltinEnabled: __DEV__,
      sessionDescriptionHandlerFactoryOptions: { peerConnectionConfiguration: { iceServers: config.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }] } },
      delegate: { onInvite: (invitation) => this.receiveInvite(invitation) },
    });
    const registerer = new Registerer(userAgent, { expires: 300 });
    const sipScope = new DisposableScope();
    this.#sipListeners = sipScope;
    let transportConnectedOnce = false;
    let recoveryRegistration: Promise<void> | undefined;
    let reconnectWatchdog: ReturnType<typeof setTimeout> | undefined;
    const clearReconnectWatchdog = () => {
      if (reconnectWatchdog) clearTimeout(reconnectWatchdog);
      reconnectWatchdog = undefined;
    };
    const registrationStateListener = (state: RegistererState) => {
      if (this.#registerer !== registerer) return;
      this.connectionState$.next(state === RegistererState.Registered ? TelnyxConnectionState.CONNECTED : TelnyxConnectionState.CONNECTING);
    };
    registerer.stateChange.addListener(registrationStateListener);
    sipScope.add(() => registerer.stateChange.removeListener(registrationStateListener));
    const transportStateListener = (state: unknown) => {
      if (this.#userAgent !== userAgent) return;
      if (String(state) === 'Disconnected') {
        this.connectionState$.next(TelnyxConnectionState.CONNECTING);
        clearReconnectWatchdog();
        reconnectWatchdog = setTimeout(() => {
          if (this.#userAgent === userAgent && this.currentConnectionState !== TelnyxConnectionState.CONNECTED) {
            this.connectionState$.next(TelnyxConnectionState.DISCONNECTED);
          }
        }, 12_000);
        return;
      }
      if (String(state) !== 'Connected') return;
      clearReconnectWatchdog();
      if (!transportConnectedOnce) {
        transportConnectedOnce = true;
        return;
      }
      this.connectionState$.next(TelnyxConnectionState.CONNECTING);
      recoveryRegistration ||= registerAndWait(registerer)
        .then(() => {
          if (this.#userAgent === userAgent) this.connectionState$.next(TelnyxConnectionState.CONNECTED);
        })
        .catch((error) => {
          logTelephonyError('recover-sip-registration', error, { username: config.username });
          if (this.#userAgent === userAgent) this.connectionState$.next(TelnyxConnectionState.DISCONNECTED);
        })
        .finally(() => { recoveryRegistration = undefined; });
    };
    userAgent.transport.stateChange.addListener(transportStateListener);
    sipScope.add(() => userAgent.transport.stateChange.removeListener(transportStateListener));
    sipScope.add(clearReconnectWatchdog);
    sipScope.add(() => { userAgent.delegate = undefined; });
    this.#userAgent = userAgent;
    this.#registerer = registerer;
    try {
      await userAgent.start();
      await registerAndWait(registerer);
      if (Platform.OS === 'android') RNCallKeep.setAvailable(true);
    } catch (error) {
      sipScope.dispose();
      await settleTelephony('rollback-failed-sip-registration', registerer.unregister(), { username: config.username });
      await settleTelephony('stop-failed-sip-user-agent', userAgent.stop(), { username: config.username });
      if (this.#userAgent === userAgent) this.#userAgent = undefined;
      if (this.#registerer === registerer) this.#registerer = undefined;
      if (this.#sipListeners === sipScope) this.#sipListeners = undefined;
      this.connectionState$.next(TelnyxConnectionState.DISCONNECTED);
      throw error;
    }
  }

  async #teardownSipRegistration() {
    const registerer = this.#registerer;
    const userAgent = this.#userAgent;
    this.#registerer = undefined;
    this.#userAgent = undefined;
    this.#sipListeners?.dispose();
    this.#sipListeners = undefined;
    if (registerer) await settleTelephony('unregister-sip-extension', registerer.unregister(), { username: this.#config?.username });
    if (userAgent) await settleTelephony('stop-sip-user-agent', userAgent.stop(), { username: this.#config?.username });
  }

  async logout() {
    pendingNativeActions.forEach(({ timer }) => clearTimeout(timer));
    pendingNativeActions.clear();
    await Promise.all(this.currentCalls.map((call) => settleTelephony('hangup-call-during-logout', call.hangup('local_ended'), { callId: call.callId })));
    await this.#teardownSipRegistration();
    this.currentCalls.forEach((call) => call.dispose());
    this.#calls.clear();
    this.calls$.next([]);
    this.activeCall$.next(null);
    this.connectionState$.next(TelnyxConnectionState.DISCONNECTED);
    if (Platform.OS === 'android') RNCallKeep.setAvailable(false);
    InCallManager.stop();
    this.#disposePlatformListeners();
  }

  async dispose() {
    await this.logout();
    this.#nativeEndTimers.forEach((timer) => clearTimeout(timer));
    this.#nativeEndTimers.clear();
    this.#nativeEndedCalls.clear();
    this.#terminalCalls.clear();
    this.connectionState$.clear();
    this.calls$.clear();
    this.activeCall$.clear();
  }

  async newCall(destination: string, localCallerName: string, remoteDisplayName: string, _callerNumber?: string, headers: Header[] = []) {
    if (!this.#userAgent || !this.#config || this.currentConnectionState !== TelnyxConnectionState.CONNECTED) throw new Error('Call service is still connecting.');
    const user = destination.match(/^sip:([^@]+)/i)?.[1] || destination;
    const target = UserAgent.makeURI(`sip:${user}@${this.#config.sipDomain}`);
    if (!target) throw new Error('The destination is invalid.');
    const inviter = new Inviter(this.#userAgent, target, {
      params: { fromDisplayName: localCallerName },
      extraHeaders: headers.map((item) => `${item.name}: ${item.value}`),
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
    });
    const call = new Call(this, inviter, { incoming: false, destination: user, callerName: remoteDisplayName || user, callerNumber: user, headers });
    this.addCall(call, true);
    RNCallKeep.startCall(call.callId, user, remoteDisplayName || user, 'generic', false);
    if (Platform.OS === 'ios') RNCallKeep.reportConnectingOutgoingCallWithUUID(call.callId);
    if (Platform.OS === 'android') InCallManager.start({ media: 'audio' });
    try {
      await inviter.invite({ requestDelegate: { onProgress: () => call.markRinging() } });
      return call;
    } catch (error) {
      await settleTelephony('cleanup-failed-outgoing-call', call.hangup('failed'), { callId: call.callId, destination: user });
      throw error;
    }
  }

  getCall(id: string) { return this.#calls.get(id); }

  setActiveCall(id: string) {
    const call = this.#calls.get(id);
    if (call) this.activeCall$.next(call);
  }

  async swapCalls(targetId: string) {
    return this.#callActionQueue.run(async () => {
      const current = this.currentActiveCall;
      const target = this.getCall(targetId);
      if (!current || !target || current.callId === target.callId) throw new Error('Both calls are required for swapping.');
      if (current.session.state !== SessionState.Established || target.session.state !== SessionState.Established || !target.currentIsHeld) {
        throw new Error('The active and held calls must both be connected before swapping.');
      }
      await current.hold();
      try {
        await target.resume();
      } catch (error) {
        try { await current.resume(); }
        catch (rollbackError) {
          this.setActiveCall(current.callId);
          this.emitCalls();
          throw new AggregateError([error, rollbackError], 'The held call could not resume and the original call could not be restored.');
        }
        this.setActiveCall(current.callId);
        this.emitCalls();
        throw error;
      }
      this.setActiveCall(target.callId);
      this.emitCalls();
    });
  }

  async mergeCalls(targetId: string) {
    return this.#callActionQueue.run(async () => {
      const current = this.currentActiveCall;
      const target = this.getCall(targetId);
      if (!current || !target || current.callId === target.callId) throw new Error('Two calls are required for a conference.');
      if (current.session.state !== SessionState.Established || target.session.state !== SessionState.Established || !target.currentIsHeld) {
        throw new Error('The active and held calls must both be connected before merging.');
      }
      const room = `${Date.now() % 100000000}`.padStart(8, '0');
      let host: Call | undefined;
      await current.hold();
      try {
        host = await this.newCall(`*3${room}`, this.#config?.displayName || this.#config?.extension || 'Vocivo user', 'Conference', undefined, [{ name: 'X-Vocivo-Call-Type', value: 'conference' }]);
        await host.waitUntilConnected();
        const referrals = await Promise.allSettled([current.transfer(`*3${room}`), target.transfer(`*3${room}`)]);
        const joined = referrals.flatMap((result, index) => result.status === 'fulfilled' ? [index === 0 ? current : target] : []);
        if (!joined.length) throw new AggregateError(referrals.flatMap((result) => result.status === 'rejected' ? [result.reason] : []), 'Neither call could join the conference.');
        this.setActiveCall(host.callId);
        this.emitCalls();
        return { room, host, participants: joined, partial: joined.length !== 2 };
      } catch (error) {
        if (host) await settleTelephony('cleanup-failed-conference-host', host.hangup('failed'), { callId: host.callId, room });
        this.setActiveCall(current.callId);
        await settleTelephony('restore-call-after-conference-failure', current.resume(), { callId: current.callId, room });
        this.emitCalls();
        throw error;
      }
    });
  }

  enablePushNotifications() {}
  disablePushNotifications() {}

  emitCalls() { this.calls$.next(this.currentCalls); }

  removeCall(id: string) {
    const call = this.#calls.get(id);
    this.#calls.delete(id);
    call?.dispose();
    this.emitCalls();
    if (this.currentActiveCall?.callId === id) {
      const remaining = this.currentCalls.find((call) => ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)) || null;
      this.activeCall$.next(remaining);
    }
    if (!this.#calls.size) InCallManager.stop();
  }

  private addCall(call: Call, active: boolean) {
    this.#calls.set(call.callId, call);
    if (active) this.activeCall$.next(call);
    this.emitCalls();
    const pending = pendingNativeActions.get(call.callId);
    if (pending) {
      pendingNativeActions.delete(call.callId);
      clearTimeout(pending.timer);
      this.nativeAction(call.callId, pending.action);
    }
  }

  private receiveInvite(invitation: Invitation) {
    const headerCallUuid = validCallUuid(requestHeader(invitation, 'X-Vocivo-Call-UUID'));
    const push = takePush(headerCallUuid);
    const callId = validCallUuid(push?.callUUID) || headerCallUuid || randomUuid();
    if (this.#isTerminalCall(callId)) {
      void settleTelephony('reject-terminal-sip-invite', terminateSession(invitation), { callId });
      return;
    }
    const callerName = typeof push?.callerName === 'string' ? push.callerName : invitation.remoteIdentity.displayName || visibleUser(invitation);
    const callerNumber = typeof push?.callerNumber === 'string' ? push.callerNumber : visibleUser(invitation);
    const call = new Call(this, invitation, { incoming: true, callId, destination: this.#config?.extension || this.#config?.username, callerName, callerNumber });
    this.addCall(call, !this.currentActiveCall);
    if (!push) {
      void settleTelephony(
        'display-unannounced-incoming-call',
        Promise.resolve(RNCallKeep.displayIncomingCall(call.callId, callerNumber, callerName, 'generic', false, { organizationName: 'Vocivo' })),
        { callId: call.callId },
      );
    }
  }

  private nativeAction(callId: string, action: 'answer' | 'end') {
    if (this.#isTerminalCall(callId)) return;
    const call = this.getCall(callId);
    if (!call) {
      console.warn(`[VocivoVoice] Native ${action} queued: SIP session is not ready.`);
      const previous = pendingNativeActions.get(callId);
      if (previous) clearTimeout(previous.timer);
      const timer = setTimeout(() => {
        pendingNativeActions.delete(callId);
        this.#rememberTerminalCall(callId);
        this.#finishNativeCall(callId, action === 'end' ? 'rejected' : 'failed', action === 'end');
      }, 30_000);
      pendingNativeActions.set(callId, { action, timer });
      return;
    }
    console.warn(`[VocivoVoice] Native ${action}: SIP session is ${call.session.state}.`);
    if (action === 'answer') {
      this.setActiveCall(callId);
      call.answer()
        .then(() => console.warn('[VocivoVoice] Native answer completed.'))
        .catch((error) => {
          logTelephonyError('native-answer-call', error, { callId });
          void settleTelephony('cleanup-failed-native-answer', call.hangup('failed'), { callId });
        });
      return;
    }
    const reason: CallTerminationReason = call.isIncoming && ![TelnyxCallState.ACTIVE, TelnyxCallState.HELD].includes(call.currentState)
      ? 'rejected'
      : 'local_ended';
    this.endCall(callId, { nativeAlreadyEnded: true, reason })
      .then(() => console.warn('[VocivoVoice] Native end completed.'))
      .catch((error) => logTelephonyError('native-end-call', error, { callId, reason }));
  }
}

export const voipClient = new VocivoVoipClient();

export const TelnyxVoipClient = {
  isLaunchedFromPushNotification: async () => false,
};

export const VoicePnBridge = {
  getVoipToken: async () => AsyncStorage.getItem(pushTokenKey),
  endCall: async (id: string) => { await voipClient.endCall(id); return true; },
  answerCall: async (id: string) => { RNCallKeep.answerIncomingCall(id); return true; },
  hideIncomingCallNotification: async () => true,
  toggleSpeaker: async () => {
    const next = !(VoicePnBridge as { speaker?: boolean }).speaker;
    (VoicePnBridge as { speaker?: boolean }).speaker = next;
    InCallManager.setForceSpeakerphoneOn(next);
    return next;
  },
  setIncomingCallRingtone: async (ringtone: string) => {
    RNCallKeep.setSettings({
      ios: { appName: 'Vocivo', supportsVideo: true, maximumCallGroups: '2', maximumCallsPerCallGroup: '5', ringtoneSound: `${ringtone}.wav`, includesCallsInRecents: true },
      android: {
        alertTitle: 'Phone account permission',
        alertDescription: 'Vocivo needs calling permission.',
        cancelButton: 'Cancel',
        okButton: 'Allow',
        additionalPermissions: [],
        foregroundService: androidForegroundService,
      },
    });
    return true;
  },
};

export async function handleAndroidRemoteMessage(message: RemoteMessage) {
  if (Platform.OS !== 'android') return;
  if (await AsyncStorage.getItem(voiceSignedInKey) !== 'true') return;
  await voipClient.wakeForIncomingPush(stringPushData(message.data));
}

export async function getAndroidPushToken() {
  if (Platform.OS !== 'android') return undefined;
  const { getMessaging, getToken } = androidMessaging();
  return getToken(getMessaging());
}

export function onAndroidPushTokenRefresh(listener: (token: string) => void) {
  if (Platform.OS !== 'android') return () => undefined;
  const { getMessaging, onTokenRefresh } = androidMessaging();
  return onTokenRefresh(getMessaging(), listener);
}

export async function setVoiceSignedIn(signedIn: boolean) {
  await AsyncStorage.setItem(voiceSignedInKey, signedIn ? 'true' : 'false');
}

export async function pushDeviceId() {
  const existing = await AsyncStorage.getItem(deviceIdKey);
  if (existing) return existing;
  const value = randomUuid();
  await AsyncStorage.setItem(deviceIdKey, value);
  return value;
}

export async function signOutVoiceDevice() {
  voipClient.disablePushNotifications();
  await settleTelephony('delete-persisted-sip-credentials', SecureStore.deleteItemAsync(voiceCredentialKey));
  const id = await pushDeviceId();
  await settleTelephony('delete-push-device-registration', api.delete(`/api/voice/devices?deviceId=${encodeURIComponent(id)}`), { deviceId: id });
  await settleTelephony('logout-voice-device', voipClient.logout());
}
