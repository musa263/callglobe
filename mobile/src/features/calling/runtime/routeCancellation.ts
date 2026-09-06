import * as SecureStore from 'expo-secure-store';
import { api } from '../../../shared/api';
import { RouteCancellationOutbox, type PendingRouteCancellation } from '../state/routeCancellation';

const key = 'vocivo.secure.route-cancellations.v1';

export const routeCancellations = new RouteCancellationOutbox({
  session: () => api.getSessionToken(),
  read: async () => {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return [];
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.some(entry => typeof entry?.session !== 'string' || typeof entry?.routeId !== 'string')) {
      throw new Error('Invalid secure call cancellation retry record.');
    }
    return entries as PendingRouteCancellation[];
  },
  write: entries => SecureStore.setItemAsync(key, JSON.stringify(entries), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  }),
  send: (routeId, session) => api.cancelVoiceRoute(routeId, session),
});
