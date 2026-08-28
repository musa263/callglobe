export type TelephonyContext = Record<string, string | number | boolean | null | undefined>;
export type Disposer = () => void;

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack || `${error.name}: ${error.message}` };
  }
  return { name: 'NonErrorFailure', message: String(error), stack: String(error) };
}

export function logTelephonyError(operation: string, error: unknown, context: TelephonyContext = {}) {
  console.error('[VocivoVoice]', {
    timestamp: new Date().toISOString(),
    operation,
    ...context,
    error: errorDetails(error),
  });
}

export async function settleTelephony<T>(operation: string, work: Promise<T>, context: TelephonyContext = {}) {
  try {
    return await work;
  } catch (error) {
    logTelephonyError(operation, error, context);
    return undefined;
  }
}

export class DisposableScope {
  #disposers = new Set<Disposer>();
  #disposed = false;

  get size() { return this.#disposers.size; }
  get disposed() { return this.#disposed; }

  add(disposer: Disposer) {
    if (this.#disposed) {
      try { disposer(); } catch (error) { logTelephonyError('late-listener-disposal', error); }
      return () => undefined;
    }
    let active = true;
    const remove = () => {
      if (!active) return;
      active = false;
      this.#disposers.delete(remove);
      try { disposer(); } catch (error) { logTelephonyError('listener-disposal', error); }
    };
    this.#disposers.add(remove);
    return remove;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    const disposers = [...this.#disposers];
    this.#disposers.clear();
    disposers.reverse().forEach((dispose) => dispose());
  }
}

export type CallTerminationReason = 'local_ended' | 'rejected' | 'unanswered' | 'remote_ended' | 'failed' | 'missed';

export class CallTerminationLedger {
  #reason?: CallTerminationReason;
  #finished = false;

  get reason() { return this.#reason; }
  get finished() { return this.#finished; }

  request(reason: CallTerminationReason) {
    if (this.#finished) return this.#reason || reason;
    this.#reason ||= reason;
    return this.#reason;
  }

  finish(fallback: CallTerminationReason = 'remote_ended') {
    this.#reason ||= fallback;
    this.#finished = true;
    return this.#reason;
  }
}

export type NativeCallEndAction = 'none' | 'end' | 'reject' | 'report_remote' | 'report_unanswered' | 'report_failed' | 'report_missed';

export function nativeCallEndAction(reason: CallTerminationReason, nativeAlreadyEnded: boolean): NativeCallEndAction {
  if (nativeAlreadyEnded) return 'none';
  if (reason === 'local_ended') return 'end';
  if (reason === 'rejected') return 'reject';
  if (reason === 'unanswered') return 'report_unanswered';
  if (reason === 'failed') return 'report_failed';
  if (reason === 'missed') return 'report_missed';
  return 'report_remote';
}

export class BackgroundWakeCoordinator<T extends { callUUID: string }> {
  #operations = new Map<string, Promise<boolean>>();
  #display: (payload: T) => Promise<void>;
  #wake: (payload: T) => Promise<void>;
  #complete: (payload: T) => void;

  constructor(input: {
    display: (payload: T) => Promise<void>;
    wake: (payload: T) => Promise<void>;
    complete?: (payload: T) => void;
  }) {
    this.#display = input.display;
    this.#wake = input.wake;
    this.#complete = input.complete || (() => undefined);
  }

  handle(payload: T) {
    const existing = this.#operations.get(payload.callUUID);
    if (existing) return existing;
    const operation = (async () => {
      await this.#display(payload);
      this.#complete(payload);
      await this.#wake(payload);
      return true;
    })().finally(() => this.#operations.delete(payload.callUUID));
    this.#operations.set(payload.callUUID, operation);
    return operation;
  }
}

export class NetworkMigrationCoordinator {
  #route?: string;
  #operation?: Promise<boolean>;
  #restart: () => Promise<boolean>;
  #recover: () => Promise<void>;

  constructor(restart: () => Promise<boolean>, recover: () => Promise<void>) {
    this.#restart = restart;
    this.#recover = recover;
  }

  observe(route: string) {
    if (this.#operation && this.#route === route) return this.#operation;
    const previous = this.#route;
    this.#route = route;
    if (!previous || previous === route || previous === 'offline' || route === 'offline') return Promise.resolve(false);
    const preceding = this.#operation;
    const operation = (async () => {
      if (preceding) await preceding;
      try {
        return await this.#restart();
      } catch (error) {
        logTelephonyError('network-migration-ice-restart', error, { previousRoute: previous, route });
        await this.#recover();
        return this.#restart();
      }
    })();
    let tracked: Promise<boolean>;
    tracked = operation.finally(() => { if (this.#operation === tracked) this.#operation = undefined; });
    this.#operation = tracked;
    return tracked;
  }
}
