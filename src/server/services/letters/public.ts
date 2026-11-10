import "server-only";
import { prisma } from "../../db";
import { longDate } from "@/lib/documents/text";

export interface PublicVerification {
  state: "VALID" | "CANCELLED";
  number: string; typeName: string; subject: string | null; issueDate: string; issueDateText: string;
  signerName: string; signerTitle: string; sha256: string | null; cancelledNote: string | null;
  /** Surat dibuat di luar portal: nomor tercatat; `sha256` terisi setelah PDF pindaian diunggah. */
  archiveOnly: boolean;
  /** Lampiran PDF: "MERGED" sudah termasuk dalam hash surat; "SEPARATE" berkas terpisah dengan hash sendiri. */
  attachments: { title: string; mode: "MERGED" | "SEPARATE"; fileName: string | null; sha256: string; size: number | null; pages: number | null }[];
}

/**
 * Verifikasi publik tanpa login: hanya metadata (nomor, jenis, perihal, tanggal, penandatangan, hash PDF) — TIDAK menampilkan isi surat.
 * Hanya surat Terbit/Dibatalkan yang dikenali; token tidak dikenal/draf → null (halaman menampilkan "tidak ditemukan").
 * Tetap berfungsi bila modul dimatikan, agar QR pada surat yang sudah beredar tidak mati.
 */
export async function verifyByToken(token: string): Promise<PublicVerification | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const d = await prisma.letterDocument.findUnique({ where: { verifyToken: token }, include: { type: { select: { name: true, kind: true, confidential: true } } } });
  if (!d || (d.status !== "ISSUED" && d.status !== "CANCELLED") || !d.number || !d.issueDate || (!d.pdfSha256 && !d.archiveOnly)) return null;
  const atts = await prisma.letterAttachment.findMany({ where: { documentId: d.id, kind: { in: ["UPLOAD_MERGED", "UPLOAD_SEPARATE"] } }, orderBy: { position: "asc" } });
  const snap = (d.snapshot ?? {}) as { signer?: { name?: string; title?: string } };
  const iso = d.issueDate.toISOString().slice(0, 10);
  return {
    state: d.status === "ISSUED" ? "VALID" : "CANCELLED", number: d.number, typeName: d.type.name, subject: d.type.kind === "SK" || d.type.confidential ? null : d.subject || null,
    issueDate: iso, issueDateText: longDate(iso), signerName: snap.signer?.name ?? "—", signerTitle: snap.signer?.title ?? "", sha256: d.pdfSha256, archiveOnly: d.archiveOnly,
    attachments: atts.filter((a) => a.sha256).map((a) => ({ title: a.title, mode: a.kind === "UPLOAD_MERGED" ? "MERGED" as const : "SEPARATE" as const, fileName: a.fileName, sha256: a.sha256!, size: a.size, pages: a.pages })),
    cancelledNote: d.status === "CANCELLED" ? d.cancelNote : null,
  };
}
