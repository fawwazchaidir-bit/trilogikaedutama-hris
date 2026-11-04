/** Sisi peramban untuk notifikasi push desktop: dukungan, izin, langganan, dan pendaftaran ke server. Hanya dipanggil dari komponen klien. */
import { api } from "@/lib/api-client";

export type PushPermission = "unsupported" | "mobile" | "default" | "granted" | "denied";

/** Fitur ini sengaja untuk DESKTOP: perangkat seluler (UA seluler atau layar sentuh utama) tidak ditawari. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches);
}

export function pushPermission(): PushPermission {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (isMobileDevice()) return "mobile";
  return Notification.permission as PushPermission;
}

const flagKey = (email: string) => `portal_push:${email.toLowerCase()}`;
export const pushFlag = {
  get: (email: string): boolean => { try { return localStorage.getItem(flagKey(email)) === "1"; } catch { return false; } },
  set: (email: string, on: boolean): void => { try { if (on) localStorage.setItem(flagKey(email), "1"); else localStorage.removeItem(flagKey(email)); } catch { /* penyimpanan diblokir: abaikan */ } },
};

const toKey = (b64u: string): Uint8Array<ArrayBuffer> => {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob((b64u + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function currentEndpoint(): Promise<string | null> {
  if (pushPermission() === "unsupported" || pushPermission() === "mobile") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

/** Minta izin, berlangganan di push service peramban, lalu daftarkan ke server. Mengembalikan alamat langganan peramban ini. */
export async function enableThisBrowser(email: string, publicKey: string): Promise<string> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Izin notifikasi ditolak. Ubah di pengaturan situs pada peramban Anda." : "Izin notifikasi belum diberikan.");
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  await api("/api/push/subscribe", { body: sub.toJSON() });
  pushFlag.set(email, true);
  return sub.endpoint;
}

/** Cabut langganan di server (dan opsional di peramban). Dipakai tombol "Matikan" dan saat keluar. */
export async function disableThisBrowser(email: string, opts: { browser: boolean }): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("/api/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => undefined);
    if (opts.browser) await sub.unsubscribe().catch(() => undefined);
  }
  if (opts.browser) pushFlag.set(email, false);
}

/** Setelah masuk: bila pengguna ini pernah mengaktifkan di peramban ini dan izin masih diberikan, daftarkan ulang diam-diam (idempoten). */
export async function ensureRegistered(email: string): Promise<void> {
  if (pushPermission() !== "granted" || !pushFlag.get(email)) return;
  const status = await api<{ available: boolean; publicKey: string | null; devices: { endpoint: string }[] }>("/api/push/status");
  if (!status.available || !status.publicKey) return;
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(status.publicKey) }));
  if (!status.devices.some((d) => d.endpoint === sub.endpoint)) await api("/api/push/subscribe", { body: sub.toJSON() });
}
