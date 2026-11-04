import "server-only";
import { prisma, transaction } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import type { Actor } from "../actor";
import { writeAudit } from "../audit";
import { PushGoneError } from "@/lib/webpush";
import { pushSubscribeSchema, pushUnsubscribeSchema } from "@/lib/validation/push";
import { pushAvailable, sendPush } from "../notify/transports";
import { assertUuid } from "./training/shared";

export const MAX_PUSH_DEVICES = 10;

export interface PushDeviceDto { id: string; label: string | null; endpoint: string; createdAt: string; lastSuccessAt: string | null }
export interface PushStatusDto { available: boolean; publicKey: string | null; devices: PushDeviceDto[]; maxDevices: number }

/** Label perangkat dari User-Agent ("Chrome · Windows"). Hanya untuk daftar "perangkat saya"; bukan pengenal. */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Peramban";
  const os = /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Linux|X11/.test(s) ? "Linux" : "Desktop";
  return `${browser} · ${os}`;
}

/** Status notifikasi desktop untuk pengguna ini: apakah server siap + perangkat yang sudah diaktifkan. Kunci publik VAPID aman dibagikan. */
export async function getPushStatus(actor: Actor): Promise<PushStatusDto> {
  const rows = await prisma.pushSubscription.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: "asc" } });
  return {
    available: pushAvailable(), publicKey: pushAvailable() ? env().WEB_PUSH_PUBLIC_KEY ?? null : null, maxDevices: MAX_PUSH_DEVICES,
    devices: rows.map((r) => ({ id: r.id, label: r.label, endpoint: r.endpoint, createdAt: r.createdAt.toISOString(), lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null })),
  };
}

/**
 * Daftarkan (atau pindahkan) langganan peramban ini ke akun pengguna. Satu peramban = satu pemilik: bila peramban yang sama didaftarkan pengguna lain
 * (komputer bersama), langganan berpindah ke pengguna yang sedang masuk sehingga pemilik lama tidak lagi menerima notifikasi di layar orang lain.
 */
export async function subscribePush(actor: Actor, raw: unknown): Promise<{ id: string }> {
  if (!pushAvailable()) throw Errors.validation("Notifikasi desktop belum diaktifkan di server (kunci VAPID belum diisi).");
  const input = parseInput(pushSubscribeSchema, raw);
  const label = deviceLabel(actor.userAgent);
  return transaction(async (tx) => {
    const existing = await tx.pushSubscription.findUnique({ where: { endpoint: input.endpoint } });
    if (!existing || existing.userId !== actor.userId) {
      const count = await tx.pushSubscription.count({ where: { userId: actor.userId } });
      if (count >= MAX_PUSH_DEVICES) throw Errors.conflict(`Maksimal ${MAX_PUSH_DEVICES} perangkat. Matikan salah satu perangkat lama terlebih dulu.`);
    }
    const row = await tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { userId: actor.userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, label },
      update: { userId: actor.userId, p256dh: input.keys.p256dh, auth: input.keys.auth, label },
    });
    if (!existing || existing.userId !== actor.userId) {
      await writeAudit(tx, actor, { action: "account.push.subscribe", entityType: "User", entityId: actor.userId, summary: `Notifikasi desktop diaktifkan pada perangkat: ${label}` });
    }
    return { id: row.id };
  });
}

/** Cabut langganan peramban ini (alamat langganan diterima dari peramban pemiliknya). Hanya langganan milik sendiri. */
export async function unsubscribePush(actor: Actor, raw: unknown): Promise<void> {
  const { endpoint } = parseInput(pushUnsubscribeSchema, raw);
  const r = await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: actor.userId } });
  if (r.count) await writeAudit(prisma, actor, { action: "account.push.unsubscribe", entityType: "User", entityId: actor.userId, summary: "Notifikasi desktop dimatikan pada satu perangkat" });
}

/** Matikan satu perangkat dari daftar (milik sendiri; ID milik orang lain → 404). */
export async function removePushDevice(actor: Actor, id: string): Promise<void> {
  assertUuid(id, "Perangkat");
  const r = await prisma.pushSubscription.deleteMany({ where: { id, userId: actor.userId } });
  if (r.count === 0) throw Errors.notFound("Perangkat");
  await writeAudit(prisma, actor, { action: "account.push.unsubscribe", entityType: "User", entityId: actor.userId, summary: "Notifikasi desktop dimatikan pada satu perangkat (dari daftar)" });
}

/** Pesan uji LANGSUNG ke semua perangkat milik pengguna (pembatas 5/jam ada pada pemanggil). Mengembalikan jumlah perangkat yang menerima. */
export async function sendTestPush(actor: Actor, brand: string): Promise<number> {
  if (!pushAvailable()) throw Errors.validation("Notifikasi desktop belum diaktifkan di server (kunci VAPID belum diisi).");
  const subs = await prisma.pushSubscription.findMany({ where: { userId: actor.userId } });
  if (subs.length === 0) throw Errors.validation("Belum ada perangkat yang diaktifkan. Klik “Aktifkan di browser ini” terlebih dulu.");
  let ok = 0, lastError = "";
  for (const s of subs) {
    try {
      await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title: `[${brand}] Uji notifikasi desktop`, body: "Bila Anda melihat ini, notifikasi desktop berfungsi.", href: "/akun", tag: "uji" });
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date() } });
      ok++;
    } catch (e) {
      if (e instanceof PushGoneError) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      else lastError = e instanceof Error ? e.message : "kesalahan tidak dikenal";
    }
  }
  if (ok === 0) throw Errors.validation(`Pesan uji gagal dikirim${lastError ? `: ${lastError.slice(0, 200)}` : ": langganan sudah tidak berlaku, aktifkan ulang di browser ini"}`);
  return ok;
}
