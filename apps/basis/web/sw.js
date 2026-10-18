/**
 * basis — service worker (S5 web-push).
 *
 * Root-scoped (served at /sw.js by Vite's `root: 'web'`), so it covers both the
 * v2 circle app (index.html) and the classic shell. Its only job today is Web
 * Push: render an OS notification from pinboard's `WebPushSender` payload
 * ({title, body, ...}) and focus/open the app when the user taps it.
 *
 * Delivery is driven server-side by a Node-hosted pinboard with VAPID keys; this
 * file is the browser receiver. See src/web/webPushClient.js for the
 * subscription half (register → permission → subscribe → pinboard.subscribeWebPush).
 */
/* eslint-env serviceworker */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : '' }; }

  const title = payload.title || 'Onderling';
  const options = {
    body: payload.body || '',
    tag: payload.tag || undefined,
    data: { url: payload.url || '/', ...(payload.data || {}) },
    icon: payload.icon || undefined,
    badge: payload.badge || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      // Focus an already-open basis window rather than spawning a new one.
      if ('focus' in client) { try { await client.focus(); return; } catch { /* fall through to openWindow */ } }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
