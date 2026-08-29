import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (error) { console.error('Vocivo push payload could not be decoded', error); }
  const title = data.title || 'Incoming Vocivo call';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Open Vocivo to answer this call.',
    icon: '/vocivo-icon-192.png',
    badge: '/vocivo-icon-192.png',
    tag: data.tag || 'vocivo-incoming-call',
    renotify: true,
    requireInteraction: true,
    data: { type: data.type || 'vocivo.incoming_call', url: data.url || '/?incoming=1' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/?incoming=1', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.postMessage({ type: 'vocivo.incoming_call' });
      await existing.focus();
      return;
    }
    await self.clients.openWindow(targetUrl);
  }));
});
