/** public/sw.js dijalankan di sandbox dengan API service worker tiruan: tampilan notifikasi, tautan klik yang aman, fokus/buka jendela. */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Handler = (e: Record<string, unknown>) => void;
function boot(windows: { url: string; focus?: () => Promise<void>; navigate?: (u: string) => Promise<void> }[] = []) {
  const handlers: Record<string, Handler> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (t: string, h: Handler) => { handlers[t] = h; },
    skipWaiting: () => undefined,
    location: { origin: "https://portal.trilogika.test" },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
    clients: { claim: async () => undefined, matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u); } },
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL });
  const waits: Promise<unknown>[] = [];
  const mk = (extra: Record<string, unknown> = {}) => ({ waitUntil: (p: Promise<unknown>) => { waits.push(p); }, ...extra });
  return { handlers, shown, opened, mk, settle: () => Promise.all(waits) };
}
const push = (data: unknown) => ({ data: { json: () => data } });

describe("service worker notifikasi desktop", () => {
  it("push → selalu menampilkan notifikasi (judul/isi dipotong, tautan dalam situs, ikon lembaga, tag)", async () => {
    const sw = boot();
    sw.handlers.push!(sw.mk(push({ title: "T".repeat(200), body: "B".repeat(400), href: "/training/tugas-saya", tag: "n-12" })));
    await sw.settle();
    expect(sw.shown).toHaveLength(1);
    expect((sw.shown[0]!.title).length).toBe(120);
    expect((sw.shown[0]!.options.body as string).length).toBe(240);
    expect(sw.shown[0]!.options).toMatchObject({ icon: "/brand/logo.png", tag: "n-12", data: { href: "/training/tugas-saya" } });
  });
  it("muatan kosong/rusak tetap menampilkan notifikasi umum (peramban mewajibkan setiap push terlihat)", async () => {
    const sw = boot();
    sw.handlers.push!(sw.mk({ data: null }));
    sw.handlers.push!(sw.mk({ data: { json: () => { throw new Error("bukan JSON"); } } }));
    await sw.settle();
    expect(sw.shown.map((s) => s.title)).toEqual(["Notifikasi baru", "Notifikasi baru"]);
    expect(sw.shown.every((s) => (s.options.data as { href: string }).href === "/notifikasi")).toBe(true);
  });
  it.each(["https://evil.example/phish", "//evil.example/x", "javascript:alert(1)", "notifikasi", "", 5, null, "/" + "a".repeat(400)])("tautan tidak aman %j → dialihkan ke /notifikasi", async (href) => {
    const sw = boot();
    sw.handlers.push!(sw.mk(push({ title: "x", href })));
    await sw.settle();
    expect((sw.shown[0]!.options.data as { href: string }).href).toBe("/notifikasi");
  });
  it("klik: menutup notifikasi dan memfokuskan jendela portal yang ada lalu membuka tautannya", async () => {
    const calls: string[] = [];
    const sw = boot([{ url: "https://lain.example/", focus: async () => { calls.push("salah"); } }, { url: "https://portal.trilogika.test/dashboard", focus: async () => { calls.push("fokus"); }, navigate: async (u) => { calls.push(`nav:${u}`); } }]);
    let closed = false;
    sw.handlers.notificationclick!(sw.mk({ notification: { close: () => { closed = true; }, data: { href: "/training/pemantauan" } } }));
    await sw.settle();
    expect(closed).toBe(true);
    expect(calls).toEqual(["fokus", "nav:https://portal.trilogika.test/training/pemantauan"]);
    expect(sw.opened).toEqual([]);
  });
  it("klik tanpa jendela portal → membuka jendela baru; tautan berbahaya pada data notifikasi tetap tidak dipakai", async () => {
    const sw = boot([]);
    sw.handlers.notificationclick!(sw.mk({ notification: { close: () => undefined, data: { href: "https://evil.example/" } } }));
    await sw.settle();
    expect(sw.opened).toEqual(["https://portal.trilogika.test/notifikasi"]);
  });
});
