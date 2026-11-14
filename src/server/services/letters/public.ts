import "server-only";
import { prisma } from "../../db";
import { longDate } from "@/lib/documents/text";
import { PUBLIC_TYPE_NAME_ALLOWED } from "@/lib/documents/templates";

/** Nama jenis surat RAHASIA sendiri mengungkap sifat surat ("Surat peringatan", "Surat evaluasi dan pembinaan"): halaman publik menampilkannya generik — kecuali yang ada di `PUBLIC_TYPE_NAME_ALLOWED` (INT-010 Surat keterangan kerja: memang untuk diverifikasi pihak luar). */
export const CONFIDENTIAL_TYPE_LABEL = "Surat rahasia (internal)";

export interface PublicVerification {
  state: "VALID" | "CANCELLED";
  number: string; typeName: string; subject: string | null; issueDate: string; issueDateText: string;
  signerName: string; signerTitle: string; sha256: string | null;
  /** Surat dibuat di luar portal: nomor tercatat; `sha256` terisi setelah PDF pindaian diunggah. */
  archiveOnly: boolean;
  /**
   * Lampiran PDF: "MERGED" sudah termasuk dalam hash surat; "SEPARATE" berkas terpisah dengan hash sendiri. Judul lampiran TIDAK PERNAH ditampilkan (selalu "Lampiran n"): judul bisa memuat nama klien/orang atau isi sensitif, dan hash + jumlah halaman sudah cukup untuk mencocokkan berkas.
   * NAMA FILE tidak pernah ditampilkan di halaman publik (tidak diperlukan untuk memverifikasi; sering memuat nama klien/orang).
   */
  attachments: { title: string; mode: "MERGED" | "SEPARATE"; sha256: string; size: number | null; pages: number | null }[];
}

/**
 * Verifikasi publik tanpa login: hanya data PENGENAL AMAN (nomor, jenis, perihal*, tanggal, penandatangan, hash PDF, status) — TIDAK menampilkan isi surat, ALASAN
 * PEMBATALAN (catatan internal), nama file maupun judul lampiran, perihal pada surat rahasia atau SK (*), dan nama jenis surat rahasia. Rincian itu tetap tersedia bagi pengguna berwenang di
 * halaman surat di Persuratan.
 * Hanya surat Terbit/Dibatalkan yang dikenali; token tidak dikenal/draf → null (halaman menampilkan "tidak ditemukan").
 * Tetap berfungsi bila modul dimatikan, agar QR pada surat yang sudah beredar tidak mati.
 */
export async function verifyByToken(token: string): Promise<PublicVerification | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const d = await prisma.letterDocument.findUnique({ where: { verifyToken: token }, include: { type: { select: { name: true, kind: true, confidential: true, series: true, code: true } } } });
  if (!d || (d.status !== "ISSUED" && d.status !== "CANCELLED") || !d.number || !d.issueDate || (!d.pdfSha256 && !d.archiveOnly)) return null;
  const atts = await prisma.letterAttachment.findMany({ where: { documentId: d.id, kind: { in: ["UPLOAD_MERGED", "UPLOAD_SEPARATE"] } }, orderBy: { position: "asc" } });
  const snap = (d.snapshot ?? {}) as { signer?: { name?: string; title?: string } };
  const iso = d.issueDate.toISOString().slice(0, 10);
  const sensitive = d.type.kind === "SK" || d.type.confidential;                    // perihal disamarkan (SK / rahasia)
  return {
    state: d.status === "ISSUED" ? "VALID" : "CANCELLED", number: d.number, typeName: d.type.confidential && !PUBLIC_TYPE_NAME_ALLOWED.has(`${d.type.series}:${d.type.code}`) ? CONFIDENTIAL_TYPE_LABEL : d.type.name, subject: sensitive ? null : d.subject || null,
    issueDate: iso, issueDateText: longDate(iso), signerName: snap.signer?.name ?? "—", signerTitle: snap.signer?.title ?? "", sha256: d.pdfSha256, archiveOnly: d.archiveOnly,
    attachments: atts.filter((a) => a.sha256).map((a, i) => ({ title: `Lampiran ${i + 1}`, mode: a.kind === "UPLOAD_MERGED" ? "MERGED" as const : "SEPARATE" as const, sha256: a.sha256!, size: a.size, pages: a.pages })),
  };
}
