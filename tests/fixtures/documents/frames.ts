import { attachmentText, dayDate, timeRange } from "@/lib/documents/text";
import { b, body, cell, center, dk, diktum, doc, i, labels, li, ol, p, row, t, table, th } from "@/lib/documents/builders";
import type { DocFrame, DocLetterhead, DocSignatory } from "@/lib/documents/frame";
import type { PmNode } from "@/lib/documents/content";
import { demoLogo, demoSignature, demoStamp } from "./assets";

/** Fixture dokumen FIKTIF yang meniru tiga surat contoh (penawaran 080, permohonan narasumber 034, SK). Tanpa data pribadi nyata. */
export async function letterhead(): Promise<DocLetterhead> {
  return {
    logo: await demoLogo(), tagline: "Lembaga Pelatihan Kerja Berbasis Kompetensi", name: "TRILOGIKA EDUTAMA",
    addressLines: ["Grha Trilogika, Jln. Ontoseno 47, Jambon 01/21, Kel. Trihanggo, Kec. Gamping, Kab. Sleman, Daerah Istimewa Yogyakarta 55291"],
  };
}
async function director(title = "Direktur Utama", org = "TRILOGIKA EDUTAMA"): Promise<DocSignatory> {
  return { orgName: org, title, name: "Nama Direktur, S.Psi.", signature: await demoSignature(), stamp: await demoStamp() };
}
const verify = { url: "https://verifikasi.contoh.test/verifikasi/0123456789abcdef0123456789abcdef", caption: "Dokumen ini sah secara elektronik. Pindai kode QR untuk verifikasi." };

export async function frameSuratPenawaran(): Promise<DocFrame> {
  return {
    kind: "SURAT", number: "001/TE-EKS/002/XI/2026", date: "2026-11-10", place: "Sleman", attachmentText: attachmentText(1, "berkas"), subject: "Surat Penawaran",
    recipient: { prefix: "Kepada Yth.", lines: [{ text: "Bapak/Ibu Kepala", bold: true }, { text: "SPPG Contoh Fiktif Gamping 2", bold: true }], cityPrefix: "Di", place: "Tempat" },
    salutation: "Salam Sejahtera,",
    body: doc(
      body(["Trilogika Edutama merupakan Lembaga Pusat Pendidikan dan Pelatihan (Diklat) yang dapat melaksanakan Pelatihan Berbasis Kompetensi, kami bermaksud mengajukan penawaran terkait kegiatan ", b("Diklat dan Sertifikasi BNSP Bidang Food Production Offline Skema Demi Chef dan Chef de Partie"), " di wilayah Yogyakarta. Adapun kegiatan ini dirancang selama ", b("2 (dua) hari"), ", dengan rincian ", b("1 (satu) hari"), " pelaksanaan ", b("Diklat"), " dan ", b("1 (satu) hari"), " pelaksanaan ", b("Asesmen/Uji Kompetensi"), ". Jumlah peserta dan jadwal pelaksanaan akan disesuaikan berdasarkan kesepakatan bersama. Kegiatan Diklat dan Asesmen Sertifikasi ini dilaksanakan oleh instruktur dan asesor kompetensi yang tersertifikasi, serta mengacu pada skema dan ketentuan resmi BNSP."]),
      body("Melalui keikutsertaan dalam program ini, peserta akan memperoleh benefit, antara lain:"),
      ol([li("Mempersiapkan dapur SPPG untuk dapat meningkatkan porsi penerima manfaat melalui SDM juru masak."), li("Memastikan penerapan standar higiene, sanitasi, dan keamanan pangan di seluruh proses produksi."), li("Meningkatkan konsistensi rasa, kualitas, dan porsi makanan dalam produksi skala besar."), li("Mengoptimalkan penggunaan bahan baku sehingga meminimalkan food waste dan menekan biaya operasional.")], { indent: 1.25 }),
      body(["Demikian penawaran ini kami sampaikan. Besar harapan kami kegiatan ini dapat terlaksana sebagai bentuk kontribusi nyata dalam meningkatkan kompetensi tenaga kerja yang profesional, kompeten, dan berdaya saing. Penawaran ini berlaku selama 5 (lima) hari kalender sejak tanggal surat diterbitkan. Untuk memudahkan koordinasi dan komunikasi lebih lanjut, Bapak/Ibu dapat menugaskan perwakilan untuk menghubungi nomor hotline kami di +62 857-0124-6319 (Sdri. Sari)."]),
      body("Atas perhatian dan kerja samanya, diucapkan terima kasih."),
    ),
    closing: "Salam.", signatories: [await director()], cc: [], attachments: [], letterhead: await letterhead(), verify, footerText: "Trilogika Edutama Training Institute Yogyakarta", draft: false,
  };
}

export async function frameSuratNarasumber(): Promise<DocFrame> {
  return {
    kind: "SURAT", number: "001/TE-EKS/003/XI/2026", date: "2026-11-09", place: "Sleman", attachmentText: attachmentText(1, "halaman"), subject: "Surat Permohonan Narasumber",
    recipient: { prefix: "Kepada Yth.", lines: [{ text: "Bapak Contoh Narasumber", bold: true }], cityPrefix: "Di", place: "Tempat" },
    salutation: "Dengan Hormat,",
    body: doc(
      body("Seiring pesatnya perkembangan dunia kerja dan penerapan sistem pelatihan berbasis kompetensi, tuntutan terhadap ketersediaan instruktur yang memiliki kualifikasi metodologi pengajaran terstandar serta profesional menjadi semakin krusial. Dalam rangka mendukung peningkatan mutu, kompetensi, serta profesionalisme tenaga pengajar di bidang metodologi pelatihan sesuai standar nasional (SKKNI), kami dari Trilogika Edutama Yogyakarta berencana mengadakan Pelatihan dan Sertifikasi BNSP Bidang Metodologi Pelatihan Lv. 4 Skema Instruktur. Adapun kegiatan tersebut akan dilaksanakan pada:"),
      labels([row("Hari, tanggal", dayDate("2026-11-11")), row("Waktu", timeRange("09:00", "16:00")), row("Tempat", [t("Zoom Meeting ("), i("Online"), t(")")])], { indent: 1.25, labelWidth: 3.2 }),
      body("Sehubungan dengan hal tersebut, kami memohon kesediaan Bapak untuk menjadi Narasumber Utama sekaligus mengajak Narasumber yang akan berkolaborasi bersama dalam mengampu kegiatan pelatihan tersebut. Kami percaya bahwa pengalaman dan pengetahuan Bapak akan memberikan banyak manfaat bagi peserta pelatihan. Besar harapan kami agar Bapak bersedia menjadi narasumber pada kegiatan tersebut. Untuk informasi lebih lanjut, Bapak dapat menghubungi kontak 0857-0124-6319 (Sdri. Sari)."),
      body("Demikian surat permohonan ini kami sampaikan, atas perhatian dan kerjasamanya diucapkan terima kasih."),
    ),
    closing: null, signatories: [await director()], cc: ["Arsip", "Manajer Operasional"], attachments: [], letterhead: await letterhead(), verify, footerText: null, draft: false,
  };
}

const para = (x: string) => p(x, { textAlign: "justify" });
export async function frameSk(): Promise<DocFrame> {
  const nik: PmNode[] = [row("Nama", [b("NAMA KARYAWAN FIKTIF, S.Mat.")]), row("NIK", "0000000000000000"), row("Tempat, tanggal lahir", "Sleman, 1 Januari 2000"), row("Alamat", "Jl. Contoh No. 1, Sleman (data fiktif)"), row("Jabatan", "Manajer Pemasaran dan Kerjasama"), row("Unit/Divisi", "Divisi Pemasaran dan Kerjasama (Marketing & Relations, kode MDK)"), row("Atasan langsung", "Direktur")];
  return {
    kind: "SK", number: "001/TE-INT/001/X/2026", date: "2026-10-01", place: "Sleman", attachmentText: null, subject: null, recipient: null, salutation: null, closing: null,
    body: doc(
      center([b("SURAT KEPUTUSAN DIREKTUR")], { spaceAfter: 0 }), center([b("LEMBAGA PELATIHAN KERJA TRILOGIKA EDUTAMA")], { spaceAfter: 0 }), center("Nomor: 001/TE-INT/001/X/2026", { spaceAfter: 8 }),
      center([b("TENTANG")], { spaceAfter: 0 }), center([b("PENGANGKATAN MANAJER PEMASARAN DAN KERJASAMA")], { spaceAfter: 8 }), center([b("DIREKTUR LEMBAGA PELATIHAN KERJA TRILOGIKA EDUTAMA,")], { spaceAfter: 8 }),
      diktum([
        dk([ol([li("bahwa dalam rangka mencapai tujuan jangka pendek dan jangka panjang perusahaan, diperlukan struktur organisasi dan jajaran personel yang menjalankan fungsi secara jelas dan terukur;"), li("bahwa jabatan Manajer Pemasaran dan Kerjasama merupakan bagian dari struktur organisasi yang perlu diisi oleh personel yang memiliki kompetensi dan integritas;"), li("bahwa Saudara/i yang namanya tercantum dalam Diktum KESATU dipandang cakap dan memenuhi syarat untuk diangkat dalam jabatan tersebut.")], { style: "lower-alpha" })], "Menimbang"),
        dk([ol([li("Akta Pendirian Commanditaire Vennootschap (data fiktif);"), li("Izin Operasional/Tanda Daftar LPK Nomor 2211340401;"), li("Peraturan Perusahaan LPK Trilogika Edutama.")])], "Mengingat"),
      ], { labelWidth: 2.6 }),
      center([b("MEMUTUSKAN:")], { spaceAfter: 6 }),
      diktum([
        dk([para("KEPUTUSAN DIREKTUR TENTANG PENGANGKATAN MANAJER PEMASARAN DAN KERJASAMA LEMBAGA PELATIHAN KERJA TRILOGIKA EDUTAMA.")], "Menetapkan"),
        dk([para("Mengangkat Saudara/i:"), labels(nik, { labelWidth: 4.2 }), para("sebagai Manajer Pemasaran dan Kerjasama Lembaga Pelatihan Kerja Trilogika Edutama terhitung mulai tanggal 1 Oktober 2026.")]),
        dk([para("Uraian tugas, tanggung jawab, wewenang, indikator kinerja, dan kewajiban pelaporan sebagaimana tercantum dalam Lampiran yang merupakan bagian tidak terpisahkan dari Keputusan ini.")]),
        dk([para("Dalam melaksanakan tugasnya, yang bersangkutan bertanggung jawab langsung kepada Direktur dan wajib menyampaikan laporan kinerja secara berkala.")]),
        dk([para("Keputusan ini mulai berlaku sejak tanggal ditetapkan, dengan ketentuan apabila di kemudian hari terdapat kekeliruan dalam Keputusan ini, akan diadakan perbaikan sebagaimana mestinya.")]),
      ], { labelWidth: 2.6 }),
    ),
    signatories: [await director("Direktur,", "")], cc: ["Yang bersangkutan", "Manajer Operasional dan Keuangan", "Bagian Keuangan dan SDM", "Arsip"],
    attachments: [{
      title: "URAIAN JABATAN — Manajer Pemasaran dan Kerjasama",
      body: doc(
        p([b("C. Tugas dan Tanggung Jawab")]),
        ol([li("Menjabarkan target revenue tahunan menjadi target bulanan dan target per program, lalu menerbitkan Rencana Kampanye paling lambat H-60 sebelum pelaksanaan."), li("Memimpin penemuan kebutuhan klien, menyetujui proposal, bernegosiasi, dan menyusun MoU atau SPK sampai serah terima."), li("Membina, membagi tugas, dan menilai kinerja staf divisi.")]),
        p([b("D. Wewenang dan Batas Kewenangan")]),
        table(["Wewenang", "Batas Kewenangan", "Di atas batas, disetujui oleh"], [["Memberikan diskon pada penawaran B2B", "Sampai 10% dari harga dasar", "Manajer Operasional dan Keuangan; di atas 20%: Direktur"], ["Menyetujui dan mengirim proposal atau surat penawaran", "Nilai sampai Rp50.000.000 dan sesuai margin minimum", "Direktur"]], [30, 35, 35]),
        p([b("E. Indikator Kinerja Utama (KPI)")]),
        table(["Indikator", "Target", "Periode", "Sumber Data"], [["Win rate B2B", "≥ 25%", "Bulanan", "CRM B2B"], ["Konversi proposal menjadi kontrak", "≥ 35%", "Bulanan", "CRM B2B dan Log Penawaran"], ["Kesalahan kritikal pada materi, iklan, dan penawaran", "0 insiden", "Bulanan", "Log Insiden"]], [40, 18, 18, 24]),
      ),
      signatory: await director("Direktur,", ""),
    }],
    letterhead: await letterhead(), verify, footerText: null, draft: false,
  };
}

/** Surat Edaran (INT-005) meniru contoh "Memo Internal" Trilogika: judul, Nomor, TENTANG + perihal, paragraf, daftar bernomor, penutup. Isi fiktif generik. */
export async function frameEdaran(): Promise<DocFrame> {
  const number = "001/TE-INT/005/II/2026";
  const pj = (c: Parameters<typeof p>[0]) => p(c, { textAlign: "justify", spaceAfter: 12 });
  const lj = (c: Parameters<typeof p>[0]) => li(p(c, { textAlign: "justify", spaceAfter: 0 }));
  return {
    kind: "EDARAN", number, date: "2026-02-10", place: "Sleman", attachmentText: null, subject: null, recipient: null, salutation: null, closing: null,
    body: doc(
      center([t("MEMO INTERNAL", "bold", "underline")], { spaceAfter: 0 }), center([`Nomor : ${number}`], { spaceAfter: 14 }),
      center([b("TENTANG")], { spaceAfter: 0 }), center([b("PENYESUAIAN JAM KERJA SELAMA BULAN RAMADHAN 1447 H")], { spaceAfter: 0 }), center([b("&")], { spaceAfter: 0 }), center([b("CUTI BERSAMA HARI RAYA IDUL FITRI 1447 H")], { spaceAfter: 14 }),
      pj("Sehubungan dengan pelaksanaan Ibadah Puasa Ramadhan 1447 H (2026 M), bersama ini disampaikan beberapa ketentuan sebagai berikut:"),
      ol([
        lj(["Jadwal operasional kantor selama bulan Ramadhan disesuaikan menjadi hari ", b("Senin–Jumat, pukul 08.00–16.00 WIB"), "."]),
        lj(["Cuti Bersama Hari Raya Idul Fitri 1447 H dilaksanakan pada tanggal ", b("17–20 Maret 2026"), " dan ", b("23–24 Maret 2026."), ""]),
        lj(["Kegiatan operasional kantor kembali berjalan normal mulai tanggal ", b("25 Maret 2026.")]),
      ], { indent: 0.4 }),
      pj("Berkenaan dengan hal tersebut, seluruh staf diharapkan untuk memperhatikan dan melaksanakan hal-hal berikut:"),
      ol([
        lj("Mengikuti kegiatan kerja bakti pada tanggal 16 Maret 2026 dalam rangka persiapan Cuti Bersama Idul Fitri 1447 H."),
        lj("Memastikan seluruh peralatan kantor, termasuk instalasi listrik, kompor gas, dan peralatan lainnya, dalam kondisi aman sebelum ditinggalkan selama masa cuti bersama."),
      ], { indent: 0.4 }),
      pj("Demikian memo internal ini disampaikan untuk menjadi perhatian dan dilaksanakan sebagaimana mestinya. Atas perhatian dan kerja samanya, diucapkan terima kasih."),
    ),
    signatories: [await director()], cc: [], attachments: [], letterhead: await letterhead(), verify, footerText: "Trilogika Edutama Training Institute Yogyakarta", draft: false,
  };
}
void cell; void th;
