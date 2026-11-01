import "server-only";
import { z } from "zod";
import { prisma, transaction } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import type { Actor } from "../actor";
import { writeAudit } from "../audit";
import { blockedSeconds, recordFailure } from "../auth/rate-limit";
import { emailAvailable, sendEmail, sendWhatsapp, whatsappAvailable } from "../notify/transports";
import { getTwoFactorStatus, type TwoFactorStatus } from "./two-factor";
import { normalizeWhatsappNumber } from "@/lib/phone";

export interface AccountDto {
  name: string;
  email: string;
  role: Actor["role"];
  twoFactor: TwoFactorStatus & { required: boolean };
  notifications: {
    email: boolean;
    whatsapp: boolean;
    whatsappNumber: string | null;
    /** Saluran tersedia di server (dikonfigurasi). */
    emailAvailable: boolean;
    whatsappAvailable: boolean;
  };
}

export async function getAccount(actor: Actor): Promise<AccountDto> {
  const [u, tf, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }),
    getTwoFactorStatus(actor),
    prisma.companySettings.findUnique({ where: { id: 1 }, select: { twoFactorRequiredForAdmins: true } }),
  ]);
  return {
    name: u.name, email: u.email, role: u.role,
    twoFactor: { ...tf, required: !!settings?.twoFactorRequiredForAdmins && u.role !== "EMPLOYEE" },
    notifications: { email: u.notifyEmail, whatsapp: u.notifyWhatsapp, whatsappNumber: u.whatsappNumber, emailAvailable: emailAvailable(), whatsappAvailable: whatsappAvailable() },
  };
}

const prefsSchema = z.object({
  notifyEmail: z.boolean().optional(),
  notifyWhatsapp: z.boolean().optional(),
  /** Nomor WhatsApp (0812…, +62812…, 62812…). Kosong = hapus. */
  whatsappNumber: z.string().trim().max(40).nullable().optional(),
});

export async function updateNotificationPrefs(actor: Actor, raw: unknown): Promise<AccountDto["notifications"]> {
  const input = parseInput(prefsSchema, raw);
  const current = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  let number: string | null | undefined = undefined;
  if (input.whatsappNumber !== undefined) {
    if (input.whatsappNumber === null || input.whatsappNumber === "") number = null;
    else {
      number = normalizeWhatsappNumber(input.whatsappNumber);
      if (!number) throw Errors.validation("Nomor WhatsApp tidak valid. Contoh: 0812-3456-7890 atau +62 812 3456 7890.", { whatsappNumber: "Nomor tidak valid" });
    }
  }
  const finalNumber = number === undefined ? current.whatsappNumber : number;
  const finalWa = input.notifyWhatsapp ?? current.notifyWhatsapp;
  if (finalWa && !finalNumber) throw Errors.validation("Isi nomor WhatsApp sebelum mengaktifkan notifikasi WhatsApp.", { whatsappNumber: "Nomor wajib diisi" });
  await transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.userId },
      data: { ...(input.notifyEmail !== undefined ? { notifyEmail: input.notifyEmail } : {}), notifyWhatsapp: finalWa, ...(number !== undefined ? { whatsappNumber: number } : {}) },
    });
    await writeAudit(tx, actor, {
      action: "account.notification_prefs", entityType: "User", entityId: actor.userId, summary: "Preferensi notifikasi diubah",
      before: { email: current.notifyEmail, whatsapp: current.notifyWhatsapp, hasNumber: !!current.whatsappNumber },
      after: { email: input.notifyEmail ?? current.notifyEmail, whatsapp: finalWa, hasNumber: !!finalNumber },
    });
  });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  return { email: u.notifyEmail, whatsapp: u.notifyWhatsapp, whatsappNumber: u.whatsappNumber, emailAvailable: emailAvailable(), whatsappAvailable: whatsappAvailable() };
}

const testSchema = z.object({ channel: z.enum(["EMAIL", "WHATSAPP"]) });
const TEST_LIMIT = { max: 5, windowMs: 3_600_000, blockMs: 3_600_000 };

/** Kirim pesan uji LANGSUNG (bukan lewat antrean) agar pengguna melihat hasilnya; dibatasi 5 per jam. */
export async function sendTestNotification(actor: Actor, raw: unknown): Promise<{ sent: true }> {
  const { channel } = parseInput(testSchema, raw);
  const key = `notify-test:${actor.userId}`;
  const wait = await blockedSeconds(key);
  if (wait > 0) throw Errors.rateLimited(`Terlalu banyak pesan uji. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`, { retryAfterSeconds: wait });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const brand = (await prisma.companySettings.findUnique({ where: { id: 1 }, select: { name: true } }))?.name ?? "Trilogika Edutama";
  await recordFailure(key, TEST_LIMIT);
  try {
    if (channel === "EMAIL") {
      if (!emailAvailable()) throw Errors.validation("Email belum dikonfigurasi di server (SMTP).");
      await sendEmail({ to: u.email, subject: `[${brand}] Pesan uji notifikasi`, text: `Halo ${u.name},\n\nIni pesan uji dari ${brand} HRIS. Bila Anda menerimanya, notifikasi email berfungsi.` });
    } else {
      if (!whatsappAvailable()) throw Errors.validation("WhatsApp belum dikonfigurasi di server.");
      if (!u.whatsappNumber) throw Errors.validation("Isi dan simpan nomor WhatsApp terlebih dahulu.", { whatsappNumber: "Nomor belum diisi" });
      await sendWhatsapp({ to: u.whatsappNumber, text: `Halo ${u.name}, ini pesan uji dari ${brand} HRIS. Notifikasi WhatsApp berfungsi.` });
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AppError") throw e;
    throw Errors.validation(`Pesan uji gagal dikirim: ${e instanceof Error ? e.message.slice(0, 200) : "kesalahan tidak dikenal"}`);
  }
  return { sent: true };
}
