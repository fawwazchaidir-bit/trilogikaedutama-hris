/**
 * Isi awal (templat) khusus tiap jenis surat. Setiap jenis punya susunan sendiri — bukan kerangka umum "[isi surat]" — supaya staf cukup mengganti bagian [bertanda kurung siku]
 * dan menyesuaikan seperlunya. Surat TIDAK dapat diajukan selama masih ada teks [bertanda kurung siku] (lihat hasPlaceholder). Templat hanyalah titik awal: staf tetap dapat
 * menyunting seluruh isinya, dan jenis yang sudah dikustomisasi Direktur tidak ditimpa (lihat ensureDefaultTypes).
 * Kop, nomor, perihal, alamat tujuan, salam, tanda tangan, dan QR disusun otomatis oleh renderer — templat hanya memuat ISI surat.
 */
import { b, body, center, doc, labels, li, ol, p, row, v } from "./builders";

const ph = (label: string) => `[${label}]`;
const TERIMA_KASIH = "Atas perhatian dan kerja samanya, kami ucapkan terima kasih.";
const lb = (...rows: [string, string][]) => labels(rows.map(([k, val]) => row(k, ph(val))), { indent: 1.25, labelWidth: 3.2 });
const num = (...items: string[]) => ol(items.map((x) => li(ph(x))), { indent: 1.25 });

// ───────────────────────── Surat eksternal ─────────────────────────

/** EKS-01 Penawaran B2C: pelatihan dan sertifikasi untuk perorangan. */
export const PENAWARAN_B2C = doc(
  body(["Trilogika Edutama adalah lembaga pelatihan kerja yang menyelenggarakan pelatihan dan sertifikasi kompetensi bagi perorangan. Melalui surat ini kami menawarkan program ", b(ph("nama program")), " yang dirancang untuk meningkatkan keterampilan dan kesiapan kerja peserta."]),
  body("Program ini mencakup hal-hal berikut:"),
  lb(["Pelaksanaan", "jadwal dan durasi"], ["Metode", "tatap muka / daring"], ["Lokasi", "tempat atau tautan"], ["Investasi", "biaya per peserta"]),
  body("Peserta akan memperoleh:"),
  num("manfaat pertama (materi/praktik)", "manfaat kedua (sertifikat/uji kompetensi)", "fasilitas yang diperoleh peserta"),
  body(["Pendaftaran dapat dilakukan paling lambat ", b(ph("batas pendaftaran")), " melalui ", ph("kontak / tautan pendaftaran"), ". ", TERIMA_KASIH]),
);

/** EKS-02 Penawaran B2B: in-house training dan sertifikasi untuk perusahaan/instansi. */
export const PENAWARAN_B2B = doc(
  body(["Trilogika Edutama merupakan Lembaga Pusat Pendidikan dan Pelatihan yang melaksanakan pelatihan berbasis kompetensi. Kami bermaksud mengajukan penawaran kegiatan ", b(ph("nama program")), " bagi ", ph("nama perusahaan / instansi"), "."]),
  body("Melalui keikutsertaan dalam program ini, peserta akan memperoleh manfaat, antara lain:"),
  ol([li(ph("manfaat pertama")), li(ph("manfaat kedua"))], { indent: 1.25 }),
  body("Rincian pelaksanaan dan investasi program terlampir pada surat ini."),
  body("Atas perhatian dan kerja samanya, diucapkan terima kasih."),
);

/** EKS-04 Penawaran/ajakan kerja sama: perguruan tinggi, lembaga, atau mitra. */
export const KERJA_SAMA = doc(
  body(["Trilogika Edutama adalah lembaga pelatihan kerja berbasis kompetensi yang berfokus pada peningkatan kompetensi sumber daya manusia. Kami bermaksud mengajak ", ph("nama lembaga / perguruan tinggi"), " untuk menjalin kerja sama di bidang ", b(ph("bidang kerja sama")), "."]),
  body("Ruang lingkup kerja sama yang kami usulkan meliputi:"),
  num("ruang lingkup pertama", "ruang lingkup kedua", "ruang lingkup ketiga"),
  body("Adapun manfaat yang dapat diperoleh kedua belah pihak antara lain:"),
  num("manfaat bagi mitra", "manfaat bagi Trilogika Edutama"),
  body(["Apabila Bapak/Ibu berkenan, kami siap mengatur pertemuan untuk membahas rencana kerja sama ini lebih lanjut pada waktu yang Bapak/Ibu tentukan. Narahubung kami: ", ph("nama dan nomor telepon"), ". ", TERIMA_KASIH]),
);

/** EKS-05 Permohonan dan perizinan. */
export const PERMOHONAN = doc(
  body(["Sehubungan dengan rencana pelaksanaan ", b(ph("nama kegiatan")), " yang diselenggarakan oleh Trilogika Edutama, dengan ini kami mengajukan permohonan ", b(ph("izin penggunaan ruang / peralatan / perizinan lain")), " dengan rincian sebagai berikut:"]),
  lb(["Hari, tanggal", "hari, tanggal"], ["Waktu", "jam mulai – selesai"], ["Tempat/barang", "ruang atau peralatan yang dimohon"], ["Peserta", "perkiraan jumlah"]),
  body("Kami berkomitmen menjaga ketertiban, kebersihan, dan keamanan selama kegiatan berlangsung serta bertanggung jawab atas fasilitas yang digunakan."),
  body("Demikian permohonan ini kami sampaikan. Atas perkenan dan kerja sama Bapak/Ibu, kami ucapkan terima kasih."),
);

/** EKS-06 Undangan. */
export const UNDANGAN = doc(
  body(["Dalam rangka ", b(ph("nama kegiatan: pembukaan pelatihan / rapat koordinasi")), ", kami mengundang Bapak/Ibu untuk hadir pada:"]),
  lb(["Hari, tanggal", "hari, tanggal"], ["Waktu", "jam mulai – selesai"], ["Tempat", "tempat / tautan"], ["Acara", "susunan acara singkat"]),
  body(["Mengingat pentingnya kegiatan tersebut, kehadiran Bapak/Ibu sangat kami harapkan. Mohon konfirmasi kehadiran kepada ", ph("nama narahubung dan nomor telepon"), " paling lambat ", ph("tanggal konfirmasi"), "."]),
  body("Demikian undangan ini kami sampaikan. Atas kehadiran Bapak/Ibu, kami ucapkan terima kasih."),
);

/** EKS-07 Pemberitahuan (perubahan jadwal/lokasi, dll.). */
export const PEMBERITAHUAN = doc(
  body(["Sehubungan dengan ", ph("alasan perubahan"), ", bersama ini kami beritahukan bahwa kegiatan ", b(ph("nama kegiatan")), " yang semula dijadwalkan pada ", ph("jadwal / lokasi semula"), " mengalami perubahan menjadi:"]),
  lb(["Hari, tanggal", "hari, tanggal baru"], ["Waktu", "jam baru"], ["Tempat", "tempat / tautan baru"]),
  body("Ketentuan lain dalam pelaksanaan kegiatan tersebut tidak mengalami perubahan. Mohon informasi ini dapat diteruskan kepada pihak-pihak yang berkepentingan."),
  body("Demikian pemberitahuan ini kami sampaikan. Kami mohon maaf atas ketidaknyamanan yang timbul dan berterima kasih atas pengertian serta kerja samanya."),
);

/** EKS-08 Permohonan sertifikasi dan uji kompetensi (kepada LSP). */
export const SERTIFIKASI = doc(
  body(["Sehubungan dengan penyelenggaraan ", b(ph("nama pelatihan")), " berbasis kompetensi oleh Trilogika Edutama, dengan ini kami mengajukan permohonan penyelenggaraan uji kompetensi dengan rincian sebagai berikut:"]),
  lb(["Skema sertifikasi", "nama dan kode skema"], ["Jumlah peserta", "jumlah peserta uji"], ["Hari, tanggal", "hari, tanggal uji"], ["Tempat uji (TUK)", "nama dan alamat TUK"]),
  body("Daftar peserta beserta dokumen persyaratan administrasi terlampir pada surat ini. Kami siap menyediakan sarana, prasarana, dan pendamping yang diperlukan selama pelaksanaan uji kompetensi."),
  body("Demikian permohonan ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih."),
);

/** EKS-09 Keterangan dan rekomendasi. */
export const KETERANGAN = doc(
  body("Yang bertanda tangan di bawah ini menerangkan bahwa:"),
  lb(["Nama", "nama lengkap"], ["Asal instansi", "instansi / perusahaan"], ["Jabatan", "jabatan"]),
  body(["telah mengikuti ", b(ph("nama pelatihan")), " yang diselenggarakan oleh Trilogika Edutama pada ", ph("tanggal pelaksanaan"), " dengan hasil ", ph("hasil / predikat / kehadiran"), "."]),
  body(["Surat keterangan ini dibuat untuk ", ph("keperluan"), ". Demikian surat ini dibuat dengan sebenarnya agar dapat dipergunakan sebagaimana mestinya."]),
);

/** EKS-10 Keuangan dan penagihan. */
export const PENAGIHAN = doc(
  body(["Sehubungan dengan terlaksananya ", b(ph("nama kegiatan")), " pada ", ph("tanggal pelaksanaan"), ", bersama ini kami sampaikan tagihan pembayaran dengan rincian sebagai berikut:"]),
  lb(["Nomor invoice", "nomor invoice"], ["Tanggal invoice", "tanggal invoice"], ["Nominal", "Rp … (terbilang …)"], ["Jatuh tempo", "tanggal jatuh tempo"]),
  body(["Pembayaran dapat ditransfer ke rekening ", ph("nama bank, nomor rekening, atas nama"), ". Mohon konfirmasi kepada kami apabila pembayaran telah dilakukan, disertai bukti transfer."]),
  body("Demikian disampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih."),
);

/** EKS-11 Surat umum lainnya (mis. ucapan terima kasih). */
export const SURAT_UMUM = doc(
  body(["Atas nama Trilogika Edutama, kami menyampaikan terima kasih yang sebesar-besarnya atas ", ph("dukungan / kerja sama / bantuan"), " yang telah Bapak/Ibu berikan pada ", b(ph("kegiatan")), "."]),
  body(ph("uraian singkat dampak atau hal yang ingin disampaikan")),
  body("Semoga hubungan baik ini dapat terus terjalin dan membawa manfaat bagi kita bersama. Demikian disampaikan, terima kasih."),
);

/** EKS-12 Perjanjian kerja sama (MoU/PKS): kerangka pasal. Wajib ditinjau pihak hukum sebelum ditandatangani. */
export const PERJANJIAN = doc(
  center([b("PERJANJIAN KERJA SAMA")], { spaceAfter: 0 }),
  center([b("ANTARA")], { spaceAfter: 0 }),
  center([b("TRILOGIKA EDUTAMA DAN "), b(ph("NAMA MITRA"))], { spaceAfter: 0 }),
  center(["Nomor: ", v("nomor")], { spaceAfter: 10 }),
  body(["Pada hari ini ", ph("hari"), ", tanggal ", ph("tanggal"), ", bertempat di ", ph("tempat"), ", yang bertanda tangan di bawah ini:"]),
  lb(["PIHAK PERTAMA", "nama, jabatan, dan alamat Trilogika Edutama"], ["PIHAK KEDUA", "nama, jabatan, dan alamat mitra"]),
  body("Pihak Pertama dan Pihak Kedua selanjutnya disebut Para Pihak, dengan ini sepakat mengadakan kerja sama dengan ketentuan sebagai berikut:"),
  center([b("Pasal 1 — Maksud dan Tujuan")], { spaceAfter: 2 }),
  body(ph("maksud dan tujuan kerja sama")),
  center([b("Pasal 2 — Ruang Lingkup")], { spaceAfter: 2 }),
  body(ph("ruang lingkup kegiatan")),
  center([b("Pasal 3 — Jangka Waktu")], { spaceAfter: 2 }),
  body(["Perjanjian ini berlaku selama ", ph("jangka waktu"), " terhitung sejak tanggal ditandatangani dan dapat diperpanjang atas kesepakatan Para Pihak."]),
  center([b("Pasal 4 — Hak dan Kewajiban")], { spaceAfter: 2 }),
  body(ph("hak dan kewajiban Pihak Pertama dan Pihak Kedua")),
  center([b("Pasal 5 — Pembiayaan")], { spaceAfter: 2 }),
  body(ph("ketentuan biaya dan pembayaran")),
  center([b("Pasal 6 — Penyelesaian Perselisihan")], { spaceAfter: 2 }),
  body("Segala perselisihan yang timbul dari perjanjian ini diselesaikan secara musyawarah untuk mufakat. Apabila tidak tercapai kesepakatan, Para Pihak akan menempuh jalur sesuai peraturan perundang-undangan yang berlaku."),
  center([b("Pasal 7 — Penutup")], { spaceAfter: 2 }),
  body(["Perjanjian ini dibuat dalam rangkap ", ph("jumlah"), " bermeterai cukup dan mempunyai kekuatan hukum yang sama bagi Para Pihak. Demikian perjanjian ini dibuat dan ditandatangani oleh Para Pihak pada hari, tanggal, dan tempat sebagaimana tersebut di awal perjanjian."]),
);

/** EKS-13 Berita acara pelaksanaan dan serah terima (pihak eksternal). */
export const BERITA_ACARA_EKS = doc(
  center([b("BERITA ACARA "), b(ph("PELAKSANAAN / SERAH TERIMA"))], { spaceAfter: 0 }),
  center(["Nomor: ", v("nomor")], { spaceAfter: 10 }),
  body(["Pada hari ini ", ph("hari"), ", tanggal ", ph("tanggal"), ", bertempat di ", ph("tempat"), ", telah dilaksanakan ", b(ph("kegiatan / serah terima")), " antara:"]),
  num("nama, jabatan, instansi — Pihak Pertama", "nama, jabatan, instansi — Pihak Kedua"),
  body("Adapun hasil pelaksanaan dan serah terima tersebut adalah sebagai berikut:"),
  num("uraian hasil pertama", "uraian hasil kedua"),
  body(["Demikian berita acara ini dibuat dengan sebenarnya dalam rangkap ", ph("jumlah"), " untuk dipergunakan sebagaimana mestinya."]),
);

// ───────────────────────── Surat internal ─────────────────────────

/** INT-03 Surat pemberitahuan (jam kerja, hari libur, perubahan jadwal, kebijakan). */
export const INT_PEMBERITAHUAN = doc(
  body(["Sehubungan dengan ", ph("dasar / latar belakang"), ", dengan ini diberitahukan kepada ", ph("seluruh karyawan / divisi tertentu"), " bahwa ", b(ph("isi pemberitahuan")), " dengan ketentuan sebagai berikut:"]),
  lb(["Berlaku mulai", "tanggal"], ["Berlaku untuk", "sasaran"], ["Keterangan", "hal yang perlu diperhatikan"]),
  body("Demikian pemberitahuan ini disampaikan untuk diketahui dan dilaksanakan sebagaimana mestinya."),
);

/** INT-04 Surat undangan rapat. */
export const INT_UNDANGAN_RAPAT = doc(
  body(["Dengan ini kami mengundang Bapak/Ibu untuk menghadiri ", b(ph("nama rapat")), " yang akan dilaksanakan pada:"]),
  lb(["Hari, tanggal", "hari, tanggal"], ["Waktu", "jam mulai – selesai"], ["Tempat", "ruang / tautan rapat"], ["Agenda", "agenda rapat"]),
  body(["Mohon membawa ", ph("bahan / laporan yang diperlukan"), " dan hadir tepat waktu."]),
  body("Demikian undangan ini disampaikan. Atas kehadirannya, kami ucapkan terima kasih."),
);

/** INT-06 Surat peringatan (rahasia). Wajib ditinjau HR/pimpinan sebelum diterbitkan. */
export const INT_PERINGATAN = doc(
  body(["Berdasarkan ", ph("dasar: hasil evaluasi / ketentuan peraturan perusahaan / kejadian"), ", dengan ini diberikan ", b(ph("Surat Peringatan I / II / III")), " kepada:"]),
  lb(["Nama", "nama karyawan"], ["Nomor karyawan", "nomor karyawan"], ["Jabatan", "jabatan"], ["Divisi", "divisi"]),
  body(["atas ketidaksesuaian/pelanggaran berupa ", ph("uraian kejadian beserta tanggalnya"), "."]),
  body(["Saudara diminta untuk ", ph("perbaikan yang diharapkan"), " paling lambat ", ph("tanggal"), ". Apabila tidak terdapat perbaikan, perusahaan akan mengambil tindakan sesuai ketentuan yang berlaku."]),
  body(["Surat peringatan ini berlaku selama ", ph("jangka waktu"), " terhitung sejak tanggal diterbitkan. Demikian disampaikan untuk dipahami dan dilaksanakan."]),
);

/** INT-07 Surat izin/persetujuan (cuti besar, izin studi, dll.). */
export const INT_IZIN = doc(
  body(["Menindaklanjuti permohonan ", b(ph("jenis izin: cuti besar / izin studi / lainnya")), " yang Saudara ajukan pada ", ph("tanggal permohonan"), ", dengan ini perusahaan memberikan persetujuan kepada:"]),
  lb(["Nama", "nama karyawan"], ["Jabatan", "jabatan"], ["Keperluan", "keperluan izin"], ["Periode", "tanggal mulai – selesai"]),
  body(["Selama masa izin, Saudara diminta menyerahterimakan pekerjaan kepada ", ph("nama pengganti"), " dan tetap dapat dihubungi untuk hal-hal mendesak."]),
  body("Demikian surat persetujuan ini dibuat untuk dipergunakan sebagaimana mestinya."),
);

/** INT-08 Berita acara internal (serah terima aset, hasil rapat penting, pelaksanaan kegiatan). */
export const INT_BERITA_ACARA = doc(
  center([b("BERITA ACARA "), b(ph("SERAH TERIMA ASET / HASIL RAPAT / PELAKSANAAN KEGIATAN"))], { spaceAfter: 0 }),
  center(["Nomor: ", v("nomor")], { spaceAfter: 10 }),
  body(["Pada hari ini ", ph("hari"), ", tanggal ", ph("tanggal"), ", bertempat di ", ph("tempat"), ", telah dilaksanakan ", b(ph("kegiatan")), " yang dihadiri oleh:"]),
  num("nama dan jabatan pihak pertama", "nama dan jabatan pihak kedua"),
  body("Adapun hasil/uraian kegiatan tersebut adalah sebagai berikut:"),
  num("uraian pertama", "uraian kedua"),
  body("Demikian berita acara ini dibuat dengan sebenarnya untuk dipergunakan sebagaimana mestinya."),
);

/** INT-09 Surat evaluasi dan pembinaan (rahasia). */
export const INT_EVALUASI = doc(
  body(["Berdasarkan hasil evaluasi kinerja periode ", ph("periode evaluasi"), ", berikut disampaikan hasil evaluasi dan arahan pembinaan untuk:"]),
  lb(["Nama", "nama karyawan"], ["Jabatan", "jabatan"], ["Divisi", "divisi"], ["Periode", "periode penilaian"]),
  body("Hasil evaluasi:"),
  num("capaian dan kekuatan", "area yang perlu ditingkatkan"),
  body("Arahan pembinaan:"),
  num("langkah pembinaan pertama beserta targetnya", "langkah pembinaan kedua beserta targetnya"),
  body(["Evaluasi lanjutan akan dilakukan pada ", ph("tanggal"), ". Demikian disampaikan, semoga menjadi bahan perbaikan dan pengembangan diri."]),
);

/** INT-10 Surat keterangan kerja (rahasia; dapat diverifikasi pihak luar). Tanpa data gaji. */
export const INT_KETERANGAN_KERJA = doc(
  body(["Yang bertanda tangan di bawah ini, ", ph("nama dan jabatan penandatangan"), " pada Trilogika Edutama, menerangkan bahwa:"]),
  lb(["Nama", "nama lengkap"], ["Nomor karyawan", "nomor karyawan"], ["Jabatan terakhir", "jabatan"], ["Status", "karyawan aktif / mantan karyawan"]),
  body(["adalah benar ", ph("bekerja / pernah bekerja"), " di Trilogika Edutama sejak ", ph("tanggal mulai"), " sampai dengan ", ph("tanggal selesai / tanggal surat ini dibuat"), "."]),
  body(["Surat keterangan ini dibuat atas permintaan yang bersangkutan untuk ", ph("keperluan"), ". Demikian surat keterangan ini dibuat dengan sebenarnya agar dapat dipergunakan sebagaimana mestinya."]),
);

/** INT-11 Administrasi internal lainnya. */
export const INT_ADMIN = doc(
  body(["Sehubungan dengan ", ph("keperluan administrasi"), ", bersama ini disampaikan ", b(ph("dokumen / informasi yang diteruskan")), " kepada ", ph("unit atau pihak tujuan"), " untuk ", ph("tindak lanjut yang diharapkan"), "."]),
  body(ph("keterangan tambahan bila diperlukan")),
  p("Demikian disampaikan untuk diketahui dan ditindaklanjuti sebagaimana mestinya.", { textAlign: "justify", firstLine: true }),
);
