import { VoiceSubject, type VoiceSubscription } from './observable';
import type { VoiceCall, VoiceClient, VoiceConnectionState, VoiceInviteHeader } from './voiceEngine';
import { terminationDeadline } from '../state/terminationDeadline';

/**
 * The one voice client the app talks to, whichever engine is underneath.
 *
 * `VoiceContext` subscribes on mount, but which engine should serve the call
 * is only known after `/api/voice/config` answers — so the two cannot simply be
 * ordered. This facade owns its own subjects and forwards whichever engine is
 * currently installed into them: subscribers never see the swap, and a
 * subscription taken before the answer arrives keeps working after it.
 *
 * That is what lets the app move from the carrier SDK to Vocivo's own SIP edge
 * without `VoiceContext` knowing either one exists.
 */

export type VoiceEngineName = 'telnyx' | 'sip';

/**
 * The bits of a call that belong to the operating system rather than to SIP:
 * the audio route, and the call screen the OS draws. Each engine brings its
 * own, so `VoiceContext` never has to know which one is carrying the call.
 */
export type PlatformCallUi = {
  /** Flips the audio route and reports where it ended up. */
  toggleSpeaker(): Promise<boolean>;
  /** Takes a call off the system call screen when the engine cannot. */
  endNativeCall(callId: string): Promise<void>;
  /** Android: dismisses the incoming-call notification once answered. */
  hideIncomingCallUi(): Promise<void>;
};

export class VoiceClientFacade implements VoiceClient {
  readonly connectionState$ = new VoiceSubject<VoiceConnectionState>('DISCONNECTED');
  readonly calls$ = new VoiceSubject<VoiceCall[]>([]);
  readonly activeCall$ = new VoiceSubject<VoiceCall | null>(null);

  private engine: VoiceClient | null = null;
  private platform: PlatformCallUi | null = null;
  private forwarding: VoiceSubscription[] = [];
  private engineName: VoiceEngineName | null = null;

  /** Which engine is carrying calls, or null before one is chosen. */
  get currentEngine() {
    return this.engineName;
  }

  /**
   * Installs an engine. Safe to call again — re-registering with the same edge
   * after a reconnect replaces the engine without disturbing the UI.
   */
  use(name: VoiceEngineName, engine: VoiceClient, platform?: PlatformCallUi) {
    if (this.engine === engine) {
      this.engineName = name;
      if (platform) this.platform = platform;
      return;
    }
    // Only the forwarding is torn down here, never the published state: going
    // through a full detach would emit DISCONNECTED between the two engines and
    // flash the UI through "signed out" in the middle of a handover.
    this.unforward();
    this.engine = engine;
    this.engineName = name;
    this.platform = platform ?? null;
    // Subscribing replays each engine subject's current value, so the facade
    // catches up to an engine that was already connected.
    this.forwarding.push(engine.connectionState$.subscribe((state) => this.connectionState$.next(state)));
    this.forwarding.push(engine.calls$.subscribe((calls) => this.calls$.next(calls)));
    this.forwarding.push(engine.activeCall$.subscribe((call) => this.activeCall$.next(call)));
  }

  /** Drops the engine and reports a disconnection, so the UI cannot show a live call on a dead engine. */
  detach() {
    this.unforward();
    if (!this.engine) return;
    this.engine = null;
    this.engineName = null;
    this.platform = null;
    this.calls$.next([]);
    this.activeCall$.next(null);
    this.connectionState$.next('DISCONNECTED');
  }

  get currentConnectionState() {
    return this.connectionState$.value;
  }

  get currentCalls() {
    return this.calls$.value;
  }

  get currentActiveCall() {
    return this.activeCall$.value;
  }

  async newCall(destination: string, callerName: string, callerNumber: string | undefined, headers: VoiceInviteHeader[]) {
    return this.require().newCall(destination, callerName, callerNumber, headers);
  }

  getCall(callId: string) {
    return this.engine?.getCall(callId);
  }

  setActiveCall(callId: string) {
    this.engine?.setActiveCall(callId);
  }

  async logout() {
    // Signing out before an engine was ever chosen is not an error; it happens
    // whenever a session ends during start-up.
    if (!this.engine) return;
    await this.engine.logout();
  }

  async toggleSpeaker() {
    if (!this.platform) return false;
    return this.platform.toggleSpeaker();
  }

  /**
   * Puts the held call through and holds the current one.
   *
   * The carrier SDK has a single call for this; on Vocivo's own edge a swap is
   * what it has always been in SIP — one re-INVITE to hold, one to resume — so
   * the facade performs it rather than requiring every engine to offer it.
   */
  async swapCalls(callId: string) {
    const engine = this.require();
    const incoming = engine.getCall(callId);
    if (!incoming) throw new Error('The held call is no longer available.');
    const swap = (engine as Partial<{ swapCalls(id: string): Promise<void> }>).swapCalls;
    if (typeof swap === 'function') {
      await swap.call(engine, callId);
      return;
    }
    const current = this.currentActiveCall;
    if (current && current.callId !== callId) await current.hold();
    await incoming.resume();
  }

  /** Used when the call object has already gone but the OS still shows a call. */
  async endNativeCall(callId: string) {
    await this.platform?.endNativeCall(callId);
  }

  async emergencyEndCall(callId: string) {
    // Capture these before awaiting: a new login may install another engine.
    const call = this.engine?.getCall(callId);
    const platform = this.platform;
    const results = await Promise.allSettled([
      Promise.resolve().then(() => call?.emergencyDispose
        ? call.emergencyDispose()
        : call ? terminationDeadline(call.hangup()) : undefined),
      Promise.resolve().then(() => platform?.endNativeCall(callId)),
    ]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Call cleanup was not fully acknowledged.');
  }

  async hideIncomingCallUi() {
    await this.platform?.hideIncomingCallUi();
  }

  private unforward() {
    this.forwarding.forEach((subscription) => subscription.unsubscribe());
    this.forwarding = [];
  }

  private require(): VoiceClient {
    if (!this.engine) throw new Error('The calling service is still starting up.');
    return this.engine;
  }
}

/** The app's single voice client. */
export const voice = new VoiceClientFacade();
