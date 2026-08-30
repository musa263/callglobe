export type CallLifecycleState = 'NEW' | 'CONNECTING' | 'RINGING' | 'ACTIVE' | 'HELD' | 'ENDED' | 'FAILED' | 'DROPPED';

// DROPPED is recoverable in the Telnyx SDK. It is emitted while the client
// changes networks and remains tracked until the signaling session reattaches.
const terminalStates = new Set<CallLifecycleState>(['ENDED', 'FAILED']);

export function isTerminalCallState(state: CallLifecycleState) {
  return terminalStates.has(state);
}

export function canTransitionCallState(current: CallLifecycleState, next: CallLifecycleState, terminationRequested = false) {
  if (current === next || isTerminalCallState(current)) return false;
  if (terminationRequested && !isTerminalCallState(next)) return false;
  if (['ACTIVE', 'HELD'].includes(current) && ['NEW', 'CONNECTING', 'RINGING'].includes(next)) return false;
  return true;
}

export class SingleFlightTermination {
  #phase: 'idle' | 'requested' | 'finished' = 'idle';
  #operation?: Promise<void>;

  get requested() { return this.#phase !== 'idle'; }
  get finished() { return this.#phase === 'finished'; }

  run(operation: () => Promise<void>) {
    if (this.#operation) return this.#operation;
    if (this.finished) return Promise.resolve();
    this.#phase = 'requested';
    this.#operation = Promise.resolve()
      .then(operation)
      .then(() => {
        this.#phase = 'finished';
      })
      .catch((error) => {
        // A failed CANCEL/BYE is not a completed termination. Release the
        // single-flight lock so the user or retry worker can try again.
        this.#phase = 'idle';
        throw error;
      })
      .finally(() => {
        this.#operation = undefined;
      });
    return this.#operation;
  }

  finish() {
    this.#phase = 'finished';
  }
}

export class SerialTaskQueue {
  #tail = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

type CallWaitingTransaction = {
  answerIncoming: () => Promise<void>;
  isIncomingAcknowledged: () => boolean;
  holdCurrent: () => Promise<void>;
  activateIncoming: () => Promise<void> | void;
  rollbackIncoming: () => Promise<void>;
  restoreCurrent: () => Promise<void> | void;
};

export async function transactCallWaiting(steps: CallWaitingTransaction) {
  let incomingAcknowledged = false;
  try {
    await steps.answerIncoming();
    incomingAcknowledged = steps.isIncomingAcknowledged();
    if (!incomingAcknowledged) throw new Error('The waiting call did not acknowledge the answer.');
    await steps.holdCurrent();
    await steps.activateIncoming();
  } catch (error) {
    let rollbackError: unknown;
    if (incomingAcknowledged) {
      try {
        await steps.rollbackIncoming();
      } catch (failure) {
        rollbackError = failure;
      }
    }
    await steps.restoreCurrent();
    if (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Call waiting failed and the incoming leg could not be rolled back.');
    }
    throw error;
  }
}

type LifecycleEntry = {
  state: CallLifecycleState;
  termination: SingleFlightTermination;
};

export class CallLifecycleRegistry {
  #calls = new Map<string, LifecycleEntry>();

  #entry(callId: string) {
    let entry = this.#calls.get(callId);
    if (!entry) {
      entry = { state: 'NEW', termination: new SingleFlightTermination() };
      this.#calls.set(callId, entry);
    }
    return entry;
  }

  state(callId: string) {
    return this.#entry(callId).state;
  }

  isTerminating(callId: string) {
    return this.#entry(callId).termination.requested;
  }

  transition(callId: string, next: CallLifecycleState) {
    const entry = this.#entry(callId);
    if (!canTransitionCallState(entry.state, next, entry.termination.requested)) return false;
    entry.state = next;
    if (isTerminalCallState(next)) entry.termination.finish();
    return true;
  }

  terminate(callId: string, operation: () => Promise<void>) {
    return this.#entry(callId).termination.run(operation);
  }

  release(callId: string) {
    this.#calls.delete(callId);
  }

  clear() {
    this.#calls.clear();
  }
}
