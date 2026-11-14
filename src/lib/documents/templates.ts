import { b, body, center, dk, diktum, doc, labels, li, ol, p, row, t, v } from "./builders";
import type { PmDoc } from "./content";
import {
  BERITA_ACARA_EKS, INT_ADMIN, INT_BERITA_ACARA, INT_EVALUASI, INT_IZIN, INT_KETERANGAN_KERJA, INT_PEMBERITAHUAN, INT_PERINGATAN, INT_UNDANGAN_RAPAT, KERJA_SAMA, KETERANGAN, PEMBERITAHUAN,
  PENAGIHAN, PENAWARAN_B2B, PENAWARAN_B2C, PERJANJIAN, PERMOHONAN, SERTIFIKASI, SURAT_UMUM, UNDANGAN,
} from "./templates-isi";

/** Jenis surat bawaan (disemai idempoten saat modul pertama dipakai). Kode tipe mengikuti glosarium Excel Register. Kebijakan dapat diubah Direktur. */
export interface DefaultLetterType {
  series: "EKS" | "INT"; code: number; name: string; description: string; kind: "SURAT" | "SK" | "TUGAS" | "EDARAN"; adminCreateOnly: boolean;
  directorOnly: boolean; signerJobLevels: ("SUPERVISOR" | "MANAGER")[]; internAllowed: boolean;
  confidential: boolean; hrCanSign: boolean; hrCanView: boolean; multiSigner: boolean; funnel: boolean;
  salutation: string | null; closing: string | null; template: PmDoc;
}

const placeholder = (label: string) => `[${label}]`;

/** Templat bawaan LAMA (kerangka umum) — hanya untuk mengenali jenis yang belum dikustomisasi saat peningkatan (lihat LEGACY_GENERIC_TEMPLATES). */
const LEGACY_PENAWARAN = doc(
      body(["Trilogika Edutama merupakan Lembaga Pusat Pendidikan dan Pelatihan yang melaksanakan pelatihan berbasis kompetensi. Kami bermaksud mengajukan penawaran kegiatan ", b(placeholder("nama program")), "."]),
      body("Melalui keikutsertaan dalam program ini, peserta akan memperoleh manfaat, antara lain:"),
      ol([li(placeholder("manfaat pertama")), li(placeholder("manfaat kedua"))], { indent: 1.25 }),
      body("Rincian pelaksanaan dan investasi program terlampir pada surat ini."),
      body("Atas perhatian dan kerja samanya, diucapkan terima kasih."),
    );
const NARASUMBER = doc(
      body(["Dalam rangka pelaksanaan ", b(placeholder("nama kegiatan")), ", kami memohon kesediaan Bapak/Ibu untuk menjadi narasumber pada kegiatan yang akan diselenggarakan pada:"]),
      labels([row("Hari, tanggal", placeholder("hari, tanggal")), row("Waktu", placeholder("jam")), row("Tempat", placeholder("tempat / tautan"))], { indent: 1.25, labelWidth: 3.2 }),
      body("Demikian surat permohonan ini kami sampaikan, atas perhatian dan kerja samanya diucapkan terima kasih."),
    );
const SK = doc(
      center([b("SURAT KEPUTUSAN DIREKTUR")], { spaceAfter: 0 }),
      center([b("LEMBAGA PELATIHAN KERJA TRILOGIKA EDUTAMA")], { spaceAfter: 0 }),
      center(["Nomor: ", v("nomor")], { spaceAfter: 8 }),
      center([b("TENTANG")], { spaceAfter: 0 }),
      center([b(placeholder("PERIHAL SK"))], { spaceAfter: 8 }),
      center([b("DIREKTUR LEMBAGA PELATIHAN KERJA TRILOGIKA EDUTAMA,")], { spaceAfter: 8 }),
      diktum([
        dk([ol([li(placeholder("pertimbangan pertama")), li(placeholder("pertimbangan kedua"))], { style: "lower-alpha", indent: 0 })], "Menimbang"),
        dk([ol([li(placeholder("dasar hukum / peraturan"))], { indent: 0 })], "Mengingat"),
      ], { labelWidth: 2.6 }),
      center([b("MEMUTUSKAN:")], { spaceAfter: 6 }),
      diktum([
        dk([p([b("Menetapkan"), "  ", placeholder("isi keputusan pertama")], { textAlign: "justify" })], "KESATU"),
        dk([p(placeholder("isi keputusan kedua"), { textAlign: "justify" })], "KEDUA"),
        dk([p(["Keputusan ini berlaku sejak tanggal ditetapkan, dengan ketentuan apabila terdapat kekeliruan akan diperbaiki sebagaimana mestinya."], { textAlign: "justify" })], "KETIGA"),
      ], { labelWidth: 2.6 }),
    );
/**
 * Surat Edaran: mengikuti contoh Memo Internal Trilogika (judul bergaris bawah, "Nomor : …", TENTANG + perihal HURUF BESAR, paragraf pembuka rata kiri-kanan tanpa
 * menjorok, daftar bernomor dengan angka tebal, paragraf kedua + daftar, penutup). Judul "TENTANG" memakai variabel {{perihal}} (diisi dari kolom Perihal, huruf besar);
 * layout (tanpa blok Nomor/Perihal/Kepada, Cambria 12 pt spasi 1,5) ditentukan jenis EDARAN pada renderer.
 */
const para = (c: Parameters<typeof p>[0]) => p(c, { textAlign: "justify", spaceAfter: 12 });
const EDARAN = doc(
      center([t("MEMO INTERNAL", "bold", "underline")], { spaceAfter: 0 }),
      center(["Nomor : ", v("nomor")], { spaceAfter: 14 }),
      center([b("TENTANG")], { spaceAfter: 0 }),
      center([{ ...v("perihal"), marks: [{ type: "bold" }] }], { spaceAfter: 14 }),
      para(["Sehubungan dengan ", placeholder("dasar / latar belakang"), ", bersama ini disampaikan beberapa ketentuan sebagai berikut:"]),
      ol([li(placeholder("ketentuan pertama")), li(placeholder("ketentuan kedua"))], { indent: 0.4 }),
      para(["Berkenaan dengan hal tersebut, seluruh staf diharapkan untuk memperhatikan dan melaksanakan hal-hal berikut:"]),
      ol([li(placeholder("hal yang harus dilaksanakan pertama")), li(placeholder("hal yang harus dilaksanakan kedua"))], { indent: 0.4 }),
      para(["Demikian edaran ini disampaikan untuk menjadi perhatian dan dilaksanakan sebagaimana mestinya. Atas perhatian dan kerja samanya, diucapkan terima kasih."]),
    );
const LEGACY_UMUM: PmDoc = doc(body(placeholder("isi surat")), body("Demikian kami sampaikan. Atas perhatian Bapak/Ibu, kami ucapkan terima kasih."));
const INTERNAL: PmDoc = doc(body(placeholder("isi surat")), body("Demikian untuk dilaksanakan sebagaimana mestinya."));

/** Templat bawaan lama yang masih berupa kerangka umum: jenis yang templatnya PERSIS salah satunya (belum dikustomisasi) ditingkatkan ke templat khusus jenis itu. */
export const LEGACY_GENERIC_TEMPLATES: readonly PmDoc[] = [LEGACY_PENAWARAN, LEGACY_UMUM, INTERNAL];

/** JSON kanonik (kunci diurutkan): jsonb PostgreSQL tidak mempertahankan urutan kunci, jadi perbandingan memakai bentuk ini. */
const canon = (x: unknown): string => JSON.stringify(x, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : val));
export const sameDoc = (a: unknown, b: unknown): boolean => canon(a) === canon(b);
export const isLegacyGenericTemplate = (templateBody: unknown): boolean => LEGACY_GENERIC_TEMPLATES.some((t) => sameDoc(t, templateBody));

type Row = [series: "EKS" | "INT", code: number, name: string, description: string, signer: "D" | "M", intern: boolean, template: PmDoc, kind?: "SK" | "TUGAS" | "EDARAN"];
/** Salam pembuka baku surat eksternal: huruf kapital hanya di awal ("Dengan hormat,"). */
export const DEFAULT_SALUTATION = "Dengan hormat,";
/** Penulisan lama bawaan sistem; dirapikan ke DEFAULT_SALUTATION pada jenis surat yang belum diubah Direktur. */
export const LEGACY_SALUTATION = "Dengan Hormat,";
const salam = (series: "EKS" | "INT") => (series === "EKS" ? DEFAULT_SALUTATION : null);

/**
 * Katalog jenis surat MASTER = sheet "Referensi" pada Register Surat Trilogika Edutama (kode lama tidak dipakai lagi).
 * D = hanya Direktur; M = Direktur atau Manajer (aturan per divisi menyusul). Kolom "Sifat" (Rahasia) & "Corong" ditangani tahap 2–3.
 */
const CATALOG: Row[] = [
  ["EKS", 1, "Penawaran B2C", "Menawarkan pelatihan dan sertifikasi kepada perorangan.", "M", false, PENAWARAN_B2C],
  ["EKS", 2, "Penawaran B2B", "Penawaran in-house training dan sertifikasi kepada perusahaan/instansi.", "M", false, PENAWARAN_B2B],
  ["EKS", 3, "Permohonan narasumber/tenaga ahli", "Memohon kesediaan praktisi menjadi narasumber pelatihan.", "M", false, NARASUMBER],
  ["EKS", 4, "Penawaran/ajakan kerja sama", "Penawaran kerja sama ke perguruan tinggi atau mitra.", "M", false, KERJA_SAMA],
  ["EKS", 5, "Permohonan dan perizinan", "Memohon izin penggunaan ruang/peralatan atau perizinan lain.", "M", false, PERMOHONAN],
  ["EKS", 6, "Undangan", "Mengundang instansi ke pembukaan pelatihan atau rapat koordinasi.", "D", false, UNDANGAN],
  ["EKS", 7, "Pemberitahuan", "Pemberitahuan perubahan jadwal atau lokasi kegiatan.", "D", false, PEMBERITAHUAN],
  ["EKS", 8, "Permohonan sertifikasi dan uji kompetensi", "Pengajuan ke LSP untuk penyelenggaraan uji kompetensi.", "D", false, SERTIFIKASI],
  ["EKS", 9, "Keterangan dan rekomendasi", "Surat keterangan telah mengikuti pelatihan; rekomendasi.", "D", false, KETERANGAN],
  ["EKS", 10, "Keuangan dan penagihan", "Pengantar invoice, penagihan, konfirmasi pembayaran.", "D", false, PENAGIHAN],
  ["EKS", 11, "Surat umum lainnya", "Ucapan terima kasih dan surat lain di luar kode lain.", "M", true, SURAT_UMUM],
  ["EKS", 12, "Perjanjian (MoU/PKS)", "Dokumen perjanjian kerja sama.", "D", false, PERJANJIAN],
  ["EKS", 13, "Berita acara pelaksanaan dan serah terima", "Berita acara pelaksanaan pelatihan dan serah terima.", "M", false, BERITA_ACARA_EKS],
  ["INT", 1, "Surat keputusan/SK (internal)", "Keputusan pimpinan: pengangkatan, penunjukan, pembentukan tim, mutasi, pemberhentian.", "D", false, SK, "SK"],
  ["INT", 2, "Surat tugas (internal)", "Penugasan karyawan (dasar Uang Harian). Hanya HR/Direktur yang membuat; isi dibangkitkan dari data penugasan.", "M", false, INTERNAL, "TUGAS"],
  ["INT", 3, "Surat pemberitahuan (internal)", "Informasi jam kerja, hari libur, perubahan jadwal, atau kebijakan.", "M", false, INT_PEMBERITAHUAN],
  ["INT", 4, "Surat undangan rapat (internal)", "Undangan rapat evaluasi, koordinasi divisi, atau rapat internal.", "M", false, INT_UNDANGAN_RAPAT],
  ["INT", 5, "Surat edaran (internal)", "Ketentuan atau arahan yang berlaku umum dan berulang.", "M", false, EDARAN, "EDARAN"],
  ["INT", 6, "Surat peringatan (internal)", "Peringatan resmi kepada karyawan (Rahasia).", "D", false, INT_PERINGATAN],
  ["INT", 7, "Surat izin/persetujuan (internal)", "Persetujuan khusus seperti cuti besar atau izin studi.", "M", false, INT_IZIN],
  ["INT", 8, "Berita acara (internal)", "Serah terima aset, hasil rapat penting, atau pelaksanaan kegiatan.", "M", false, INT_BERITA_ACARA],
  ["INT", 9, "Surat evaluasi dan pembinaan (internal)", "Hasil evaluasi kinerja dan arahan pembinaan (Rahasia).", "M", false, INT_EVALUASI],
  ["INT", 10, "Surat keterangan kerja (internal)", "Bukti hubungan kerja karyawan atau mantan karyawan (Rahasia).", "D", false, INT_KETERANGAN_KERJA],
  ["INT", 11, "Administrasi internal lainnya", "Pengantar administrasi karyawan dan kebutuhan internal lain.", "M", false, INT_ADMIN],
];

/** Sifat struktural per jenis (Register: kolom "Sifat" & penanda tangan "…atau HR", berita acara "pihak yang terlibat"). */
const CONFIDENTIAL = new Set(["INT:6", "INT:9", "INT:10"]);
/**
 * Jenis surat rahasia yang NAMA ASLINYA tetap tampil di halaman verifikasi publik (jenis rahasia lain ditampilkan generik "Surat rahasia (internal)", karena namanya sendiri mengungkap
 * sifat surat — mis. "Surat peringatan"). INT-010 Surat keterangan kerja sengaja dikecualikan: tujuannya memang diverifikasi PIHAK LUAR (pemberi kerja baru, bank, dst.). Perihal, judul lampiran,
 * nama file, dan alasan pembatalan tetap disembunyikan untuk semua surat rahasia.
 */
export const PUBLIC_TYPE_NAME_ALLOWED = new Set(["INT:10"]);
const HR_SIGN = new Set(["INT:7", "INT:10", "INT:11"]);
const HR_VIEW = new Set(["INT:10"]);
const MULTI = new Set(["EKS:13", "INT:8"]);
/** Masuk corong penjualan (Register: "Corong Penjualan = Ya"): Penawaran B2C, Penawaran B2B, Penawaran/ajakan kerja sama. */
const FUNNEL = new Set(["EKS:1", "EKS:2", "EKS:4"]);

export const DEFAULT_LETTER_TYPES: DefaultLetterType[] = CATALOG.map(([series, code, name, description, signer, intern, template, kind]) => ({
  series, code, name, description, kind: kind ?? "SURAT", adminCreateOnly: kind === "TUGAS", directorOnly: signer === "D" && !HR_SIGN.has(`${series}:${code}`), signerJobLevels: signer === "M" ? ["MANAGER"] : [], internAllowed: intern,
  confidential: CONFIDENTIAL.has(`${series}:${code}`), hrCanSign: HR_SIGN.has(`${series}:${code}`), hrCanView: HR_VIEW.has(`${series}:${code}`), multiSigner: MULTI.has(`${series}:${code}`), funnel: FUNNEL.has(`${series}:${code}`),
  salutation: kind === "SK" || kind === "TUGAS" || kind === "EDARAN" ? null : salam(series), closing: null, template,
}));
