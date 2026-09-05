# Browser Push

`webPush.js` coordinates permission, service-worker subscription and authenticated
subscription registration with `/api/voice/web-push`. `src/sw.js` stays at its
stable build entry and receives push/click events. Backend push owns VAPID sending
and tenant subscription storage. Browser/OS background restrictions still apply;
a notification is not an already-connected voice session.

Test denied permission, duplicate subscription, logout and notification click.
Run build to validate the generated service worker, then test an installed PWA.
