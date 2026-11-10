import { b, body, center, dk, diktum, doc, labels, li, ol, p, row, v } from "./builders";
import type { PmDoc } from "./content";

/** Jenis surat bawaan (disemai idempoten saat modul pertama dipakai). Kode tipe mengikuti glosarium Excel Register. Kebijakan dapat diubah Direktur. */
export interface DefaultLetterType {
  series: "EKS" | "INT"; code: number; name: string; description: string; kind: "SURAT" | "SK";
  directorOnly: boolean; signerJobLevels: ("SUPERVISOR" | "MANAGER")[]; internAllowed: boolean;
  confidential: boolean; hrCanSign: boolean; hrCanView: boolean; multiSigner: boolean; funnel: boolean;
  salutation: string | null; closing: string | null; template: PmDoc;
}

const placeholder = (label: string) => `[${label}]`;

const PENAWARAN = doc(
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
const UMUM: PmDoc = doc(body(placeholder("isi surat")), body("Demikian kami sampaikan. Atas perhatian Bapak/Ibu, kami ucapkan terima kasih."));
const INTERNAL: PmDoc = doc(body(placeholder("isi surat")), body("Demikian untuk dilaksanakan sebagaimana mestinya."));

type Row = [series: "EKS" | "INT", code: number, name: string, description: string, signer: "D" | "M", intern: boolean, template: PmDoc, kind?: "SK"];
const salam = (series: "EKS" | "INT") => (series === "EKS" ? "Dengan Hormat," : null);

/**
 * Katalog jenis surat MASTER = sheet "Referensi" pada Register Surat Trilogika Edutama (kode lama tidak dipakai lagi).
 * D = hanya Direktur; M = Direktur atau Manajer (aturan per divisi menyusul). Kolom "Sifat" (Rahasia) & "Corong" ditangani tahap 2–3.
 */
const CATALOG: Row[] = [
  ["EKS", 1, "Penawaran B2C", "Menawarkan pelatihan dan sertifikasi kepada perorangan.", "M", false, PENAWARAN],
  ["EKS", 2, "Penawaran B2B", "Penawaran in-house training dan sertifikasi kepada perusahaan/instansi.", "M", false, PENAWARAN],
  ["EKS", 3, "Permohonan narasumber/tenaga ahli", "Memohon kesediaan praktisi menjadi narasumber pelatihan.", "M", false, NARASUMBER],
  ["EKS", 4, "Penawaran/ajakan kerja sama", "Penawaran kerja sama ke perguruan tinggi atau mitra.", "M", false, PENAWARAN],
  ["EKS", 5, "Permohonan dan perizinan", "Memohon izin penggunaan ruang/peralatan atau perizinan lain.", "M", false, UMUM],
  ["EKS", 6, "Undangan", "Mengundang instansi ke pembukaan pelatihan atau rapat koordinasi.", "D", false, UMUM],
  ["EKS", 7, "Pemberitahuan", "Pemberitahuan perubahan jadwal atau lokasi kegiatan.", "D", false, UMUM],
  ["EKS", 8, "Permohonan sertifikasi dan uji kompetensi", "Pengajuan ke LSP untuk penyelenggaraan uji kompetensi.", "D", false, UMUM],
  ["EKS", 9, "Keterangan dan rekomendasi", "Surat keterangan telah mengikuti pelatihan; rekomendasi.", "D", false, UMUM],
  ["EKS", 10, "Keuangan dan penagihan", "Pengantar invoice, penagihan, konfirmasi pembayaran.", "D", false, UMUM],
  ["EKS", 11, "Surat umum lainnya", "Ucapan terima kasih dan surat lain di luar kode lain.", "M", true, UMUM],
  ["EKS", 12, "Perjanjian (MoU/PKS)", "Dokumen perjanjian kerja sama.", "D", false, UMUM],
  ["EKS", 13, "Berita acara pelaksanaan dan serah terima", "Berita acara pelaksanaan pelatihan dan serah terima.", "M", false, UMUM],
  ["INT", 1, "Surat keputusan/SK (internal)", "Keputusan pimpinan: pengangkatan, penunjukan, pembentukan tim, mutasi, pemberhentian.", "D", false, SK, "SK"],
  ["INT", 2, "Surat tugas (internal)", "Penugasan karyawan sebagai panitia, pendamping, instruktur, dsb.", "M", false, INTERNAL],
  ["INT", 3, "Surat pemberitahuan (internal)", "Informasi jam kerja, hari libur, perubahan jadwal, atau kebijakan.", "M", false, INTERNAL],
  ["INT", 4, "Surat undangan rapat (internal)", "Undangan rapat evaluasi, koordinasi divisi, atau rapat internal.", "M", false, INTERNAL],
  ["INT", 5, "Surat edaran (internal)", "Ketentuan atau arahan yang berlaku umum dan berulang.", "M", false, INTERNAL],
  ["INT", 6, "Surat peringatan (internal)", "Peringatan resmi kepada karyawan (Rahasia).", "D", false, INTERNAL],
  ["INT", 7, "Surat izin/persetujuan (internal)", "Persetujuan khusus seperti cuti besar atau izin studi.", "M", false, INTERNAL],
  ["INT", 8, "Berita acara (internal)", "Serah terima aset, hasil rapat penting, atau pelaksanaan kegiatan.", "M", false, INTERNAL],
  ["INT", 9, "Surat evaluasi dan pembinaan (internal)", "Hasil evaluasi kinerja dan arahan pembinaan (Rahasia).", "M", false, INTERNAL],
  ["INT", 10, "Surat keterangan kerja (internal)", "Bukti hubungan kerja karyawan atau mantan karyawan (Rahasia).", "D", false, INTERNAL],
  ["INT", 11, "Administrasi internal lainnya", "Pengantar administrasi karyawan dan kebutuhan internal lain.", "M", false, INTERNAL],
];

/** Sifat struktural per jenis (Register: kolom "Sifat" & penanda tangan "…atau HR", berita acara "pihak yang terlibat"). */
const CONFIDENTIAL = new Set(["INT:6", "INT:9", "INT:10"]);
const HR_SIGN = new Set(["INT:7", "INT:10", "INT:11"]);
const HR_VIEW = new Set(["INT:10"]);
const MULTI = new Set(["EKS:13", "INT:8"]);
/** Masuk corong penjualan (Register: "Corong Penjualan = Ya"): Penawaran B2C, Penawaran B2B, Penawaran/ajakan kerja sama. */
const FUNNEL = new Set(["EKS:1", "EKS:2", "EKS:4"]);

export const DEFAULT_LETTER_TYPES: DefaultLetterType[] = CATALOG.map(([series, code, name, description, signer, intern, template, kind]) => ({
  series, code, name, description, kind: kind ?? "SURAT", directorOnly: signer === "D" && !HR_SIGN.has(`${series}:${code}`), signerJobLevels: signer === "M" ? ["MANAGER"] : [], internAllowed: intern,
  confidential: CONFIDENTIAL.has(`${series}:${code}`), hrCanSign: HR_SIGN.has(`${series}:${code}`), hrCanView: HR_VIEW.has(`${series}:${code}`), multiSigner: MULTI.has(`${series}:${code}`), funnel: FUNNEL.has(`${series}:${code}`),
  salutation: kind === "SK" ? null : salam(series), closing: null, template,
}));
