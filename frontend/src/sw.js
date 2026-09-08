import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (error) { console.error('Vocivo push payload could not be decoded', error); }
  const tag = data.tag || `vocivo-call-${data.callId || 'unknown'}`;
  const expiresAt = Date.parse(data.expiresAt || '') || Date.now() + 45_000;
  const close = async () => { for (const notification of await self.registration.getNotifications({tag})) notification.close(); };
  event.waitUntil((async () => {
    const cache = await caches.open('vocivo-call-deadlines-v1');
    const key = new URL(`/__call-status/${encodeURIComponent(tag)}`, self.location.origin).href;
    // Prune finished-call markers; preserve them across service-worker restarts to reject late delivery.
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (Number(await response?.text()) < Date.now()) await cache.delete(request);
    }
    if (data.type === 'vocivo.call_ended') {
      await cache.put(key, new Response(String(Date.now() + 120_000)));
      await close(); return;
    }
    if (expiresAt <= Date.now() || await cache.match(key)) return;
    await self.registration.showNotification(data.title || 'Incoming Vocivo call', {
      body: data.body || 'Open Vocivo to answer this call.', icon:'/vocivo-icon-192.png', badge:'/vocivo-icon-192.png',
      tag, renotify:true, requireInteraction:false,
      data:{type:'vocivo.incoming_call',url:data.url || '/?incoming=1',expiresAt},
    });
    await new Promise(resolve => setTimeout(resolve, Math.min(45_000, Math.max(0, expiresAt - Date.now()))));
    await close();
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data?.expiresAt <= Date.now()) return;
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

self.addEventListener('message', event => {
  if (event.data?.type !== 'vocivo.close-call-notifications') return;
  event.waitUntil(self.registration.getNotifications().then(items => {
    for (const item of items) if (item.data?.type === 'vocivo.incoming_call') item.close();
  }));
});
