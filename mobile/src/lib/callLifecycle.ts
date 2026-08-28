export type CallLifecycleState = 'NEW' | 'CONNECTING' | 'RINGING' | 'ACTIVE' | 'HELD' | 'ENDED' | 'FAILED' | 'DROPPED';

const terminalStates = new Set<CallLifecycleState>(['ENDED', 'FAILED', 'DROPPED']);

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
      .finally(() => { this.#phase = 'finished'; });
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
