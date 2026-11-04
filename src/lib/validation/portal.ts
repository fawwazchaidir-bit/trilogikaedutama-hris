/** Validasi pesan banner beranda (broadcast Direktur). */
import { z } from "zod";
import { isoDate, optionalText, requiredText } from "./common";

export const BANNER_TITLE_MAX = 120;
export const BANNER_BODY_MAX = 500;

export const bannerSchema = z.object({
  title: requiredText(3, BANNER_TITLE_MAX, "Judul pesan"),
  body: optionalText(BANNER_BODY_MAX, "Isi pesan"),
  /** Tanggal terakhir pesan tampil (WIB, inklusif). Kosong = sampai diganti. */
  expiresAt: isoDate.nullish().transform((v) => v ?? null),
  /** Kirim juga sebagai notifikasi ke seluruh akun aktif (dalam aplikasi; email/WhatsApp hanya bagi yang memilihnya). */
  notify: z.boolean({ error: "Nilai harus benar/salah" }).default(false),
});
