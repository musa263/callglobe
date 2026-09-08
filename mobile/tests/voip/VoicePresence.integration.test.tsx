import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { useVoicePresence } from '../../src/features/calling/state/useVoicePresence';

jest.mock('../../src/features/calling/engine/session', () => ({ createRouteId: () => '2f73e2ab-d04b-45b9-97cd-09c087bbf2f6' }));
jest.mock('../../src/shared/api', () => ({ api: { post: (...args: unknown[]) => mockPost(...args) } }));
const mockPost = jest.fn<Promise<unknown>, any[]>();
let renderer: TestRenderer.ReactTestRenderer;
let change: (state: AppStateStatus) => void;
let remove: jest.Mock;
let subscription: jest.SpyInstance;
let previous: string | null;
function Probe({ scope = 'company:employee', ready = true, busy = false }) {
  useVoicePresence(scope, ready, busy);
  return null;
}
beforeEach(() => {
  jest.useFakeTimers();
  previous = AppState.currentState;
  AppState.currentState = 'active';
  mockPost.mockReset().mockResolvedValue({ ok: true });
  remove = jest.fn();
  subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { change = callback; return { remove }; });
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); subscription.mockRestore(); AppState.currentState = previous as typeof AppState.currentState; jest.useRealTimers(); });
test('registered, busy, background-idle and disconnected states are published without resetting the device sequence', async () => {
  await act(async () => { renderer = TestRenderer.create(<Probe />); });
  expect(mockPost.mock.calls.at(-1)?.[1].state).toBe('online');
  await act(async () => { renderer.update(<Probe busy />); });
  expect(mockPost.mock.calls.at(-1)?.[1].state).toBe('busy');
  await act(async () => { AppState.currentState = 'background'; change('background'); });
  expect(mockPost.mock.calls.at(-1)?.[1].state).toBe('busy');
  await act(async () => { renderer.update(<Probe />); });
  expect(mockPost.mock.calls.at(-1)?.[1].state).toBe('offline');
  await act(async () => { AppState.currentState = 'active'; change('active'); renderer.update(<Probe ready={false} />); });
  expect(mockPost.mock.calls.at(-1)?.[1].state).toBe('offline');
  const sequences = mockPost.mock.calls.map(call => call[1].sequence);
  expect(sequences).toEqual([...new Set(sequences)].sort((a, b) => a - b));
  expect(subscription).toHaveBeenCalledTimes(1);
});
test('unmount removes the listener and prevents further requests; nonbusiness scope publishes nothing', async () => {
  await act(async () => { renderer = TestRenderer.create(<Probe scope="" />); });
  expect(mockPost).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Probe />); });
  act(() => renderer.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
  const count = mockPost.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(mockPost).toHaveBeenCalledTimes(count);
});
test('a slow update coalesces state changes, and an old scope cannot publish a queued update after unmount', async () => {
  let finish!: (value: unknown) => void;
  mockPost.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { renderer = TestRenderer.create(<Probe />); renderer.update(<Probe busy />); });
  await act(async () => { renderer.update(<Probe ready={false} />); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
  await act(async () => { finish({ ok: true }); });
  expect(mockPost).toHaveBeenCalledTimes(1);
});
