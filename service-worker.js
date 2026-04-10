// service-worker.js — Why Not Bar v4 (Web Push)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ─── Push: muestra la notificación aunque el dispositivo esté bloqueado ───────
self.addEventListener('push', e => {
  let data = { title: 'Why Not Bar', body: 'Nueva alerta' };
  try { data = e.data?.json() || data; } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './Logo.png',
      badge: './Logo.png',
      tag: data.tag || 'whynot-alert',
      requireInteraction: true,       // no desaparece sola
      vibrate: [300, 100, 300, 100, 300],
      data: { url: self.registration.scope },
    })
  );
});

// ─── Al tocar la notificación → abre o trae la app al frente ──────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        for (const c of clients) {
          if ('focus' in c) return c.focus();
        }
        return self.clients.openWindow('./');
      })
  );
});
