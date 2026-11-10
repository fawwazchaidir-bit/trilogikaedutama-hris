import "server-only";
import { prisma } from "../../db";
import { longDate } from "@/lib/documents/text";

export interface PublicVerification {
  state: "VALID" | "CANCELLED";
  number: string; typeName: string; subject: string | null; issueDate: string; issueDateText: string;
  signerName: string; signerTitle: string; sha256: string; cancelledNote: string | null;
}

/**
 * Verifikasi publik tanpa login: hanya metadata (nomor, jenis, perihal, tanggal, penandatangan, hash PDF) — TIDAK menampilkan isi surat.
 * Hanya surat Terbit/Dibatalkan yang dikenali; token tidak dikenal/draf → null (halaman menampilkan "tidak ditemukan").
 * Tetap berfungsi bila modul dimatikan, agar QR pada surat yang sudah beredar tidak mati.
 */
export async function verifyByToken(token: string): Promise<PublicVerification | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const d = await prisma.letterDocument.findUnique({ where: { verifyToken: token }, include: { type: { select: { name: true, kind: true, confidential: true } } } });
  if (!d || (d.status !== "ISSUED" && d.status !== "CANCELLED") || !d.number || !d.pdfSha256 || !d.issueDate) return null;
  const snap = (d.snapshot ?? {}) as { signer?: { name?: string; title?: string } };
  const iso = d.issueDate.toISOString().slice(0, 10);
  return {
    state: d.status === "ISSUED" ? "VALID" : "CANCELLED", number: d.number, typeName: d.type.name, subject: d.type.kind === "SK" || d.type.confidential ? null : d.subject || null,
    issueDate: iso, issueDateText: longDate(iso), signerName: snap.signer?.name ?? "—", signerTitle: snap.signer?.title ?? "", sha256: d.pdfSha256, cancelledNote: d.status === "CANCELLED" ? d.cancelNote : null,
  };
}
