import * as SecureStore from 'expo-secure-store';
import type { Profile } from '../../shared/types';

const key = 'vocivo.account-snapshot.v1';
const maximumAge = 24 * 60 * 60 * 1000;
type Snapshot = { token: string; savedAt: number; profile: Omit<Profile, 'balance'> };

// This only gates cached presentation. Every protected request still verifies the JWT server-side.
function tokenIsCurrent(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() + 30_000;
  } catch { return false; }
}

export async function readSessionSnapshot(token: string) {
  if (!tokenIsCurrent(token)) return null;
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as Snapshot;
    const age = Date.now() - cached.savedAt;
    if (cached.token !== token || !Number.isFinite(age) || age < 0 || age > maximumAge || !cached.profile?.id || cached.profile.admin_only) return null;
    return cached.profile;
  } catch { return null; }
}

export async function saveSessionSnapshot(token: string, profile: Omit<Profile, 'balance'>) {
  await SecureStore.setItemAsync(key, JSON.stringify({ token, profile, savedAt: Date.now() }), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearSessionSnapshot() { await SecureStore.deleteItemAsync(key); }
