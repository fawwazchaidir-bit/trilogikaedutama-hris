import { b, body, center, dk, diktum, doc, labels, li, ol, p, row, v } from "./builders";
import type { PmDoc } from "./content";

/** Jenis surat bawaan (disemai idempoten saat modul pertama dipakai). Kode tipe mengikuti glosarium Excel Register. Kebijakan dapat diubah Direktur. */
export interface DefaultLetterType {
  series: "EKS" | "INT"; code: number; name: string; description: string; kind: "SURAT" | "SK";
  directorOnly: boolean; signerJobLevels: ("SUPERVISOR" | "MANAGER")[]; internAllowed: boolean;
  salutation: string | null; closing: string | null; template: PmDoc;
}

const placeholder = (label: string) => `[${label}]`;

export const DEFAULT_LETTER_TYPES: DefaultLetterType[] = [
  {
    series: "EKS", code: 2, name: "Surat Penawaran", kind: "SURAT", description: "Penawaran program pelatihan/sertifikasi kepada calon klien.",
    directorOnly: false, signerJobLevels: ["MANAGER"], internAllowed: false, salutation: "Salam Sejahtera,", closing: "Salam.",
    template: doc(
      body(["Trilogika Edutama merupakan Lembaga Pusat Pendidikan dan Pelatihan yang melaksanakan pelatihan berbasis kompetensi. Kami bermaksud mengajukan penawaran kegiatan ", b(placeholder("nama program")), "."]),
      body("Melalui keikutsertaan dalam program ini, peserta akan memperoleh manfaat, antara lain:"),
      ol([li(placeholder("manfaat pertama")), li(placeholder("manfaat kedua"))], { indent: 1.25 }),
      body("Rincian pelaksanaan dan investasi program terlampir pada surat ini."),
      body("Atas perhatian dan kerja samanya, diucapkan terima kasih."),
    ),
  },
  {
    series: "EKS", code: 3, name: "Surat Permohonan Narasumber", kind: "SURAT", description: "Permohonan kesediaan narasumber/instruktur untuk suatu kegiatan.",
    directorOnly: false, signerJobLevels: ["MANAGER"], internAllowed: false, salutation: "Dengan Hormat,", closing: null,
    template: doc(
      body(["Dalam rangka pelaksanaan ", b(placeholder("nama kegiatan")), ", kami memohon kesediaan Bapak/Ibu untuk menjadi narasumber pada kegiatan yang akan diselenggarakan pada:"]),
      labels([row("Hari, tanggal", placeholder("hari, tanggal")), row("Waktu", placeholder("jam")), row("Tempat", placeholder("tempat / tautan"))], { indent: 1.25, labelWidth: 3.2 }),
      body("Demikian surat permohonan ini kami sampaikan, atas perhatian dan kerja samanya diucapkan terima kasih."),
    ),
  },
  {
    series: "EKS", code: 1, name: "Surat Resmi Umum", kind: "SURAT", description: "Surat keluar umum ke pihak luar.",
    directorOnly: false, signerJobLevels: ["MANAGER"], internAllowed: true, salutation: "Dengan Hormat,", closing: null,
    template: doc(body(placeholder("isi surat")), body("Demikian kami sampaikan. Atas perhatian Bapak/Ibu, kami ucapkan terima kasih.")),
  },
  {
    series: "INT", code: 1, name: "Surat Keputusan (SK)", kind: "SK", description: "SK Direktur: pengangkatan, struktur, mutasi, pemberhentian (varian melalui isi templat).",
    directorOnly: true, signerJobLevels: [], internAllowed: false, salutation: null, closing: null,
    template: doc(
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
    ),
  },
];
