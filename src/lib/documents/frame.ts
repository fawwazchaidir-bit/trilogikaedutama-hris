import type { PmDoc } from "./content";

/** Gambar untuk PDF (dibaca server dari berkas privat). */
export interface DocImage { data: Buffer; mimeType: string }
/** Posisi gambar relatif terhadap kotak tanda tangan (pt). Disimpan sebagai preset per penandatangan. */
export interface ImagePlacement { x: number; y: number; w: number; h: number }

export interface DocLetterhead {
  logo: DocImage | null;
  tagline: string;        // "Lembaga Pelatihan Kerja Berbasis Kompetensi"  (Cambria bold 12)
  name: string;           // "TRILOGIKA EDUTAMA"                              (Cambria bold 14)
  addressLines: string[]; // alamat resmi (satu sumber: pengaturan lembaga)   (Cambria italic 10)
}
export interface DocSignatory {
  orgName: string; title: string; name: string;
  signature: DocImage | null; stamp: DocImage | null;
  /** Slot tanda tangan basah mitra luar: ruang kosong (tanpa gambar) di PDF. */
  external?: boolean;
  signaturePlacement?: ImagePlacement; stampPlacement?: ImagePlacement;
}
export interface DocRecipient { prefix: string | null; lines: { text: string; bold?: boolean }[]; cityPrefix: string | null; place: string | null }

/** Semua yang dibutuhkan renderer untuk satu dokumen (bagian isi = JSON editor; sisanya "bingkai" yang dikunci template). */
export interface DocFrame {
  /** SURAT: Nomor/Perihal/Kepada/salam; SK: judul + diktum; EDARAN: judul + Nomor + TENTANG di kertas (tanpa penerima), Cambria 12 pt spasi 1,5. */
  kind: "SURAT" | "SK" | "EDARAN";
  number: string | null;       // null → draf
  date: string;                // ISO tanggal surat
  place: string;               // "Sleman"
  attachmentText: string | null; subject: string | null;
  recipient: DocRecipient | null;
  salutation: string | null;
  body: PmDoc;
  closing: string | null;      // mis. "Salam." (opsional)
  signatories: DocSignatory[];
  cc: string[];
  attachments: { title: string; body: PmDoc; signatory?: DocSignatory | null }[];
  letterhead: DocLetterhead;
  verify: { url: string; caption: string } | null;
  footerText: string | null;
  draft: boolean;
}
