/**
 * Service worker — the part that runs when the site is closed.
 *
 * This is what makes a notification appear on a locked phone: the browser keeps
 * this script alive independently of any open tab, wakes it when a push arrives,
 * and hands it the payload. Without a service worker there is no way to be told
 * anything while the app is not on screen.
 *
 * Deliberately does no caching. An offline cache on a ledger is a way to show
 * somebody a stale balance and let them act on it; the app should be honest that
 * it needs the network rather than quietly serving yesterday's numbers.
 */

self.addEventListener('install', (event) => {
  // Take over without waiting for existing tabs to close, so a deploy that
  // changes this file starts applying on the next visit rather than eventually.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'حساب الصراف الذكي', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'حساب الصراف الذكي';

  const options = {
    body: payload.body || '',
    // The app icon; falls back silently if missing.
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    // A tag replaces an earlier notification with the same tag instead of
    // stacking twenty of them on the lock screen.
    tag: payload.tag || 'smart-teller',
    renotify: true,
    // Vibration is what actually gets noticed when the phone is in a pocket.
    vibrate: [200, 100, 200],
    dir: 'rtl',
    lang: 'ar',
    data: { url: payload.url || '/' }
  };

  // showNotification on the registration — NOT `new Notification()`, which is
  // illegal inside a service worker and throws.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = event.notification.data?.url || '/';

  // Focus the app if it is already open somewhere rather than opening a second copy.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
