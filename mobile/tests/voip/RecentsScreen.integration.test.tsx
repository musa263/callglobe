import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { CallLog } from '../../src/shared/types';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34 }) }));
jest.mock('expo-audio', () => ({ useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}), setAudioModeAsync: jest.fn() }));
jest.mock('../../src/features/auth/AuthContext', () => ({ useAuth: () => ({ history: mockHistory, refresh: jest.fn() }) }));
jest.mock('../../src/shared/api', () => ({ api: { get: jest.fn(async () => ({ voicemails: [] })) } }));
import { RecentsScreen } from '../../src/features/calling/screens/RecentsScreen';

const username = 'gencredkzOCCkVFTcouFTsLExmx8bpsPjDgrXS4npsOQTTRnF';
let mockHistory: CallLog[];
let renderer: TestRenderer.ReactTestRenderer;
const onRedial = jest.fn();
function renderedText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(renderedText).join(' ');
  return node && typeof node === 'object' && 'children' in node ? renderedText(node.children) : '';
}
const visibleText = () => renderedText(renderer.toJSON());
beforeEach(() => {
  onRedial.mockReset();
  mockHistory = [{ id: 'one', destination_number: username, destination_name: 'Mousa', duration_seconds: 31, total_cost: 0, status: 'completed', started_at: '2026-09-07T00:16:00Z' }];
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

test('mounted Recents hides unresolved legacy credentials and disables unsafe redial', async () => {
  await act(async () => { renderer = TestRenderer.create(<RecentsScreen onRedial={onRedial} />); });
  const output = visibleText();
  expect(output).toContain('Mousa');
  expect(output).toContain('Company extension');
  expect(output).not.toContain(username);
  const row = renderer.root.findAll((node) => node.props.accessibilityLabel === 'Call Mousa' && typeof node.props.onPress === 'function')[0]!;
  expect(row.props.disabled).toBe(true);
  expect(onRedial).not.toHaveBeenCalled();
});

test('mounted Recents displays and redials a resolved extension without modifying the target', async () => {
  mockHistory[0] = { ...mockHistory[0]!, destination_number: '2000', internal: true };
  await act(async () => { renderer = TestRenderer.create(<RecentsScreen onRedial={onRedial} />); });
  expect(visibleText()).toContain('Extension 2000');
  const row = renderer.root.findAll((node) => node.props.accessibilityLabel === 'Call Mousa' && typeof node.props.onPress === 'function')[0]!;
  act(() => row.props.onPress());
  expect(onRedial).toHaveBeenCalledWith(expect.objectContaining({ destination_number: '2000', internal: true }));
});
