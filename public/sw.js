/* Service worker Trilogika Internal Portal — HANYA untuk notifikasi push desktop (tanpa cache/offline). */
"use strict";

/** Tautan klik hanya boleh berupa jalur dalam situs ("/…"); selain itu (https://…, //host, javascript:) diabaikan. */
function safeHref(h) {
  return typeof h === "string" && h.startsWith("/") && !h.startsWith("//") && h.length <= 300 ? h : "/notifikasi";
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = String(data.title || "Notifikasi baru").slice(0, 120);
  const options = {
    body: String(data.body || "").slice(0, 240),
    icon: "/brand/logo.png",
    badge: "/brand/logo.png",
    data: { href: safeHref(data.href) },
  };
  if (data.tag) options.tag = String(data.tag).slice(0, 60);
  // Peramban mewajibkan setiap push menampilkan notifikasi (userVisibleOnly).
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(safeHref(event.notification.data && event.notification.data.href), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        if ("navigate" in w) await w.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
