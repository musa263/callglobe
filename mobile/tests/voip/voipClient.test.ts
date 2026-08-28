import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BackgroundWakeCoordinator,
  CallTerminationLedger,
  DisposableScope,
  NetworkMigrationCoordinator,
  nativeCallEndAction,
  settleTelephony,
} from '../../src/lib/voipRuntime';
import { installTransportSafety } from '../../src/lib/sipTransport';

class MockEmitter<T> {
  listeners = new Set<(value: T) => void>();
  addListener(listener: (value: T) => void) {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }
  removeListener(listener: (value: T) => void) { this.listeners.delete(listener); }
  emit(value: T) { this.listeners.forEach((listener) => listener(value)); }
}

class MockSocket {
  listeners = new Map<string, Set<(event: { code?: number; reason?: string; data?: unknown }) => void>>();
  addEventListener(event: string, listener: (event: { code?: number; reason?: string; data?: unknown }) => void) {
    const listeners = this.listeners.get(event) || new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  removeEventListener(event: string, listener: (event: { code?: number; reason?: string; data?: unknown }) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, value: { code?: number; reason?: string; data?: unknown }) {
    this.listeners.get(event)?.forEach((listener) => listener(value));
  }
}

const push = {
  callUUID: '123e4567-e89b-42d3-a456-426614174000',
  callerName: 'Mousa',
  callerNumber: '2000',
};

test('CallKeep synchronization removes callbacks before a late native event can race teardown', () => {
  const emitter = new MockEmitter<{ callUUID: string }>();
  const scope = new DisposableScope();
  const actions: string[] = [];
  const subscription = emitter.addListener(({ callUUID }) => actions.push(`answer:${callUUID}`));
  scope.add(() => subscription.remove());

  emitter.emit({ callUUID: push.callUUID });
  scope.dispose();
  emitter.emit({ callUUID: push.callUUID });

  assert.deepEqual(actions, [`answer:${push.callUUID}`]);
  assert.equal(emitter.listeners.size, 0);
  assert.equal(scope.size, 0);
});

test('CallKeep receives distinct local, rejected, and remote termination actions', () => {
  assert.equal(nativeCallEndAction('local_ended', false), 'end');
  assert.equal(nativeCallEndAction('rejected', false), 'reject');
  assert.equal(nativeCallEndAction('remote_ended', false), 'report_remote');
  assert.equal(nativeCallEndAction('unanswered', false), 'report_unanswered');
  assert.equal(nativeCallEndAction('failed', false), 'report_failed');
  assert.equal(nativeCallEndAction('missed', false), 'report_missed');
  assert.equal(nativeCallEndAction('local_ended', true), 'none');
});

test('PushKit killed-state delivery reports the native UI before waiting for SIP wake-up', async () => {
  const order: string[] = [];
  let releaseWake: (() => void) | undefined;
  const wakeBarrier = new Promise<void>((resolve) => { releaseWake = resolve; });
  const coordinator = new BackgroundWakeCoordinator({
    display: async () => { order.push('callkeep-display'); },
    complete: () => { order.push('pushkit-complete'); },
    wake: async () => { order.push('sip-wake-start'); await wakeBarrier; order.push('sip-wake-ready'); },
  });

  const first = coordinator.handle(push);
  const duplicate = coordinator.handle(push);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ['callkeep-display', 'pushkit-complete', 'sip-wake-start']);
  assert.equal(first, duplicate);
  releaseWake?.();
  assert.equal(await first, true);
  assert.deepEqual(order, ['callkeep-display', 'pushkit-complete', 'sip-wake-start', 'sip-wake-ready']);
});

test('Android background delivery can retry recovery after an interrupted cold start', async () => {
  let attempts = 0;
  const coordinator = new BackgroundWakeCoordinator({
    display: async () => undefined,
    wake: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('process was reclaimed');
    },
  });

  await assert.rejects(coordinator.handle(push), /process was reclaimed/);
  assert.equal(await coordinator.handle(push), true);
  assert.equal(attempts, 2);
});

test('Wi-Fi to cellular migration serializes ICE restart and registration recovery', async () => {
  const operations: string[] = [];
  let restarts = 0;
  const original = console.error;
  console.error = () => undefined;
  const coordinator = new NetworkMigrationCoordinator(
    async () => {
      restarts += 1;
      operations.push(`restart:${restarts}`);
      if (restarts === 1) throw new Error('WebSocket handoff in progress');
      return true;
    },
    async () => { operations.push('registration-recovery'); },
  );

  try {
    assert.equal(await coordinator.observe('wifi:192.0.2.10'), false);
    const first = coordinator.observe('cellular:carrier-a');
    const duplicate = coordinator.observe('cellular:carrier-a');
    assert.equal(first, duplicate);
    assert.equal(await first, true);
    assert.deepEqual(operations, ['restart:1', 'registration-recovery', 'restart:2']);
  } finally {
    console.error = original;
  }
});

test('a SIP CANCEL racing a local answer remains a remote termination', async () => {
  const ledger = new CallTerminationLedger();
  const answerStarted = Promise.resolve('answer-started');
  const cancelArrived = Promise.resolve().then(() => ledger.finish('remote_ended'));
  const [, reason] = await Promise.all([answerStarted, cancelArrived]);

  assert.equal(reason, 'remote_ended');
  assert.equal(ledger.request('rejected'), 'remote_ended');
  assert.equal(nativeCallEndAction(ledger.reason || 'failed', false), 'report_remote');
});

test('asynchronous telephony failures retain their stack in structured logs', async () => {
  const original = console.error;
  const entries: unknown[][] = [];
  console.error = (...values: unknown[]) => { entries.push(values); };
  try {
    await settleTelephony('mock-sip-operation', Promise.reject(new Error('mock SIP failure')), { callId: push.callUUID });
  } finally {
    console.error = original;
  }
  const record = entries[0]?.[1] as { operation?: string; error?: { stack?: string } };
  assert.equal(record.operation, 'mock-sip-operation');
  assert.match(record.error?.stack || '', /mock SIP failure/);
});

test('WebSocket 1006 triggers one fatal cleanup and removes every listener', async () => {
  const socket = new MockSocket();
  const stateChange = new MockEmitter<unknown>();
  const failures: Array<{ code?: number }> = [];
  const dispose = installTransportSafety({
    ws: socket,
    isConnected: () => true,
    send: async () => undefined,
    stateChange,
  }, {
    onFatalDisconnect: (failure) => { failures.push(failure); },
    onHeartbeatFailure: async () => undefined,
  }, { heartbeatIntervalMs: 1_000 });

  socket.emit('error', {});
  socket.emit('close', { code: 1006, reason: 'abnormal closure' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(failures.length, 1);
  dispose();
  assert.equal(stateChange.listeners.size, 0);
  assert.equal([...socket.listeners.values()].reduce((total, listeners) => total + listeners.size, 0), 0);
});

test('two missed SIP heartbeat responses trigger one signaling recovery', async () => {
  const socket = new MockSocket();
  const stateChange = new MockEmitter<unknown>();
  let sends = 0;
  let recoveries = 0;
  const dispose = installTransportSafety({
    ws: socket,
    isConnected: () => true,
    send: async (message) => {
      assert.equal(message, '\r\n\r\n');
      sends += 1;
    },
    stateChange,
  }, {
    onFatalDisconnect: async () => undefined,
    onHeartbeatFailure: async () => { recoveries += 1; },
  }, { heartbeatIntervalMs: 10, maximumMisses: 2 });

  await new Promise((resolve) => setTimeout(resolve, 38));
  dispose();
  assert.ok(sends >= 3);
  assert.equal(recoveries, 1);
});
