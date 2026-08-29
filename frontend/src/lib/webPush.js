import { api } from './api';

function decodeVapidKey(value) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function registerWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/api/voice/web-push');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(publicKey) });
  }
  await api('/api/voice/web-push', { method: 'POST', body: subscription.toJSON() });
  return true;
}
