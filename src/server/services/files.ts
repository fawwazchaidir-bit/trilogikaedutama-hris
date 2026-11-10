import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { env, lettersEnabled, trainingEnabled } from "../env";
import { canReadLetterPdf } from "./letters/access";
import { canReadTrainingFile } from "./training/document-access";
import { Errors } from "../errors";
import { writeAudit } from "../audit";
import { actorCan, type Actor } from "../actor";

export type FileKind = "LOGO" | "EMPLOYEE_PHOTO" | "LEAVE_ATTACHMENT" | "ATTENDANCE_PHOTO" | "SIGNATURE" | "DOCUMENT" | "TRAINING_DOCUMENT" | "LETTER_PDF" | "LETTER_SIGNATURE" | "LETTER_ATTACHMENT" | "LETTER_EVIDENCE";

/** Tipe yang diizinkan, diverifikasi dari MAGIC BYTES (bukan dari ekstensi / Content-Type kiriman klien). SVG sengaja ditolak (risiko XSS). */
const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/png", ext: "png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d },
];

const ALLOWED: Record<FileKind, string[]> = {
  LOGO: ["image/png", "image/jpeg"],
  EMPLOYEE_PHOTO: ["image/png", "image/jpeg"],
  LEAVE_ATTACHMENT: ["image/png", "image/jpeg", "application/pdf"],
  // Hanya dibuat oleh server (sesudah dicap & dinormalisasi menjadi JPEG), tidak pernah dari unggahan mentah klien.
  ATTENDANCE_PHOTO: ["image/jpeg"],
  // Hanya PNG hasil normalisasi server (lihat photo/signature.ts).
  SIGNATURE: ["image/png"],
  // Kontrak kerja bermaterai yang ditandatangani basah (hasil pindai) — hanya PDF.
  DOCUMENT: ["application/pdf"],
  // Dokumen proyek Training & Operations: PDF/PNG/JPEG saja (tipe diverifikasi dari magic bytes). Otorisasi per proyek dilakukan service training sebelum memanggil storeFile.
  TRAINING_DOCUMENT: ["application/pdf", "image/png", "image/jpeg"],
  // Hanya dibuat server saat surat terbit (lihat services/letters/issue.ts); tidak pernah dari unggahan klien.
  LETTER_PDF: ["application/pdf"],
  // Tanda tangan pribadi penandatangan surat (PNG ternormalisasi); izin diperiksa service persuratan (pemilik akun atau Direktur).
  LETTER_SIGNATURE: ["image/png"],
  // Lampiran PDF surat (diunggah pembuat; izin diperiksa service persuratan).
  LETTER_ATTACHMENT: ["application/pdf"],
  // Bukti Deal penawaran (PO / persetujuan klien): PDF atau JPG.
  LETTER_EVIDENCE: ["application/pdf", "image/jpeg"],
};

export function sniffMime(bytes: Uint8Array): { mime: string; ext: string } | null {
  const hit = SIGNATURES.find((s) => s.test(bytes));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

function safeName(name: string, ext: string): string {
  const base = name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "file";
  return `${base}.${ext}`;
}

/** Simpan file terverifikasi. Tidak pernah menimpa: unggahan baru = baris baru (histori dokumen tetap utuh). */
export async function storeFile(
  actor: Actor,
  kind: FileKind,
  input: { name: string; bytes: Uint8Array },
  tx: Pick<typeof prisma, "storedFile"> = prisma,
): Promise<{ id: string; mimeType: string; size: number }> {
  if ((kind === "LOGO" || kind === "SIGNATURE") && !actorCan(actor, "settings:manage")) throw Errors.forbidden();
  if (kind === "EMPLOYEE_PHOTO" && !actorCan(actor, "employee:manage")) throw Errors.forbidden();
  if (kind === "LEAVE_ATTACHMENT" && !actor.employeeId && !actorCan(actor, "leave:review")) throw Errors.forbidden();
  if (kind === "ATTENDANCE_PHOTO" && !actor.employeeId) throw Errors.forbidden();
  if (kind === "DOCUMENT" && !actorCan(actor, "document:manage")) throw Errors.forbidden();
  if ((kind === "LETTER_PDF" || kind === "LETTER_SIGNATURE" || kind === "LETTER_ATTACHMENT" || kind === "LETTER_EVIDENCE") && !lettersEnabled()) throw Errors.notFound("Halaman");
  if (kind === "TRAINING_DOCUMENT" && !trainingEnabled()) throw Errors.notFound("Halaman");
  const maxMb = kind === "DOCUMENT" || kind === "TRAINING_DOCUMENT" || kind === "LETTER_ATTACHMENT" || kind === "LETTER_EVIDENCE" || kind === "LETTER_PDF" ? env().MAX_DOCUMENT_UPLOAD_MB : env().MAX_UPLOAD_MB;
  const maxBytes = maxMb * 1024 * 1024;
  if (input.bytes.byteLength === 0) throw Errors.validation("File kosong.");
  if (input.bytes.byteLength > maxBytes) throw Errors.validation(`Ukuran file maksimal ${maxMb} MB.`);
  const sniffed = sniffMime(input.bytes);
  if (!sniffed || !ALLOWED[kind].includes(sniffed.mime)) {
    const allowed = ALLOWED[kind].map((m) => m.split("/")[1]?.toUpperCase()).join(", ");
    throw Errors.validation(`Jenis file tidak diizinkan. Gunakan: ${allowed}.`);
  }
  const buf = Buffer.from(input.bytes);
  return tx.storedFile.create({
    data: {
      kind,
      originalName: safeName(input.name, sniffed.ext),
      mimeType: sniffed.mime,
      size: buf.byteLength,
      sha256: createHash("sha256").update(buf).digest("hex"),
      data: buf,
      uploadedById: actor.userId,
    },
    select: { id: true, mimeType: true, size: true },
  });
}

/**
 * Baca file untuk ditampilkan. Aturan akses:
 *  - LOGO & SIGNATURE: semua pengguna login (tampil di header/slip; tanda tangan tampil pada slip setiap karyawan).
 *  - EMPLOYEE_PHOTO: admin (employee:view) atau karyawan pemilik foto itu sendiri.
 *  - LEAVE_ATTACHMENT: peninjau pengajuan (leave:view_all) atau pengunggahnya.
 *  - ATTENDANCE_PHOTO: peninjau absensi (attendance:view_all) atau karyawan pemilik foto itu; pembukaan oleh peninjau dicatat di audit.
 *  - TRAINING_DOCUMENT: anggota/pemantau proyek yang berwenang (lihat assertCanReadTrainingFile); dokumen yang disembunyikan tidak dapat dibuka siapa pun.
 *  - DOCUMENT: pengelola dokumen (document:view_all) atau karyawan pemilik dokumen (yang belum diarsipkan); pembukaan oleh pengelola dicatat di audit.
 * Karyawan TIDAK dapat membuka berkas milik karyawan lain.
 */
export async function readFileForActor(actor: Actor, id: string) {
  const file = await prisma.storedFile.findUnique({ where: { id } });
  if (!file) throw Errors.notFound("File");
  let ok = file.kind === "LOGO" || file.kind === "SIGNATURE";
  if (file.kind === "EMPLOYEE_PHOTO") {
    ok = actorCan(actor, "employee:view");
    if (!ok && actor.employeeId) {
      ok = (await prisma.employee.count({ where: { id: actor.employeeId, photoFileId: id } })) > 0;
    }
  }
  if (file.kind === "LEAVE_ATTACHMENT") {
    ok = actorCan(actor, "leave:view_all") || file.uploadedById === actor.userId;
    if (ok && file.kind === "LEAVE_ATTACHMENT") {
      await writeAudit(prisma, actor, { action: "file.view", entityType: "StoredFile", entityId: id, summary: "Lampiran pengajuan dibuka" });
    }
  }
  if (file.kind === "ATTENDANCE_PHOTO") {
    const own = actor.employeeId ? (await prisma.attendancePhoto.count({ where: { fileId: id, employeeId: actor.employeeId } })) > 0 : false;
    ok = own || actorCan(actor, "attendance:view_all");
    if (ok && !own) await writeAudit(prisma, actor, { action: "file.view", entityType: "StoredFile", entityId: id, summary: "Foto absensi dibuka" });
  }
  if (file.kind === "TRAINING_DOCUMENT") {
    ok = await canReadTrainingFile(actor, id);
  }
  if (file.kind === "LETTER_PDF" || file.kind === "LETTER_ATTACHMENT" || file.kind === "LETTER_EVIDENCE") ok = await canReadLetterPdf(actor, id);
  if (file.kind === "LETTER_SIGNATURE") ok = actor.role === "SUPER_ADMIN" || (await prisma.letterSigner.count({ where: { userId: actor.userId, signatureFileId: id } })) > 0;
  if (file.kind === "DOCUMENT") {
    const own = actor.employeeId ? (await prisma.employeeDocument.count({ where: { fileId: id, employeeId: actor.employeeId, archivedAt: null } })) > 0 : false;
    ok = own || actorCan(actor, "document:view_all");
    if (ok && !own) await writeAudit(prisma, actor, { action: "file.view", entityType: "StoredFile", entityId: id, summary: "Dokumen kepegawaian dibuka" });
  }
  if (!ok) throw Errors.forbidden();
  return file;
}

/** Baca untuk generator PDF (di server; pemanggil sudah mengotorisasi dokumen). */
export async function readFileBytes(id: string | null | undefined): Promise<{ data: Buffer; mimeType: string } | null> {
  if (!id) return null;
  const f = await prisma.storedFile.findUnique({ where: { id }, select: { data: true, mimeType: true } });
  return f ? { data: Buffer.from(f.data), mimeType: f.mimeType } : null;
}
