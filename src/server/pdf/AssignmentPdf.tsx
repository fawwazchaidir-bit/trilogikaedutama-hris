import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfSafe } from "./ReportPdf";
import { INK, LINE, Letterhead, MUTED, RED, SignerBlock, type PdfImage } from "./shared";
import type { AssignmentSnapshot, ReceiptSnapshot } from "../services/assignments";
import { formatDateLong, formatDateRange } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { terbilang } from "@/lib/terbilang";
import { needsMaterai } from "@/lib/assignment";

Font.registerHyphenationCallback((word) => [word]);

const FONT = 10;
const SIG = 48;

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 56, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: FONT, color: INK, lineHeight: 1.35 },
  titleWrap: { alignItems: "center", marginTop: 16, marginBottom: 14 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 16, letterSpacing: 2 },
  number: { marginTop: 6, color: MUTED },
  p: { marginBottom: 8 },
  kv: { flexDirection: "row", marginBottom: 3 },
  k: { width: 118, color: MUTED },
  colon: { width: 8 },
  v: { flex: 1, fontFamily: "Helvetica-Bold" },
  section: { fontFamily: "Helvetica-Bold", color: RED, marginTop: 10, marginBottom: 3, fontSize: 10 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 2, fontFamily: "Helvetica-Bold" },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 2.5 },
  trTotal: { flexDirection: "row", paddingVertical: 3.5, fontFamily: "Helvetica-Bold" },
  cNo: { width: 22 }, cName: { flex: 1, paddingRight: 6 }, cNik: { width: 78 }, cPos: { width: 130 },
  cDays: { width: 40, textAlign: "right" }, cRate: { width: 84, textAlign: "right" }, cTotal: { width: 92, textAlign: "right" },
  footer: { position: "absolute", left: 44, right: 44, bottom: 24, fontSize: 7.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 4 },
  watermark: { position: "absolute", top: 330, left: 60, fontSize: 80, color: "#d8d4cd", transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold", opacity: 0.55 },
});

const rp = (n: number) => formatRupiah(n, "PLAIN");

function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return <View style={s.kv}><Text style={s.k}>{k}</Text><Text style={s.colon}>:</Text><Text style={s.v}>{children}</Text></View>;
}

export interface AssignmentPdfInput { snapshot: AssignmentSnapshot; logo: PdfImage | null; signature: PdfImage | null; cancelled: boolean; printedAt: string }

/** SURAT TUGAS — dasar pemberian Uang Harian. Dirender dari snapshot yang dibekukan saat terbit. */
export function AssignmentDocument({ item }: { item: AssignmentPdfInput }) {
  const d = item.snapshot;
  const total = d.assignees.reduce((a, x) => a + x.total, 0);
  const who = d.signer ? `${d.signer.name}${d.signer.title ? `, selaku ${d.signer.title}` : ""}` : `Pimpinan ${d.company.name}`;
  return (
    <Document title={pdfSafe(`Surat Tugas ${d.number}`)} author={pdfSafe(d.company.name)} creator="Trilogika HRIS">
      <Page size="A4" style={s.page}>
        {item.cancelled && <Text style={s.watermark} fixed>DIBATALKAN</Text>}
        <Letterhead company={d.company} logo={item.logo} />
        <View style={s.titleWrap}>
          <Text style={s.title}>SURAT TUGAS</Text>
          <Text style={s.number}>Nomor: {pdfSafe(d.number)}</Text>
        </View>

        <Text style={s.p}>Yang bertanda tangan di bawah ini, {pdfSafe(who)}, {pdfSafe(d.company.name)}, dengan ini memberikan tugas kepada:</Text>
        <View style={s.th}><Text style={s.cNo}>No</Text><Text style={s.cName}>Nama</Text><Text style={s.cNik}>No. Induk</Text><Text style={s.cPos}>Jabatan</Text></View>
        {d.assignees.map((a, i) => (
          <View key={a.employeeId} style={s.tr} wrap={false}><Text style={s.cNo}>{i + 1}</Text><Text style={[s.cName, { fontFamily: "Helvetica-Bold" }]}>{pdfSafe(a.name)}</Text><Text style={s.cNik}>{pdfSafe(a.employeeNo)}</Text><Text style={s.cPos}>{pdfSafe(a.position)}</Text></View>
        ))}

        <Text style={s.section}>UNTUK MELAKSANAKAN TUGAS</Text>
        <Kv k="Maksud / tujuan">{pdfSafe(d.purpose)}</Kv>
        <Kv k="Lokasi tujuan">{pdfSafe(d.destination)}</Kv>
        <Kv k="Waktu pelaksanaan">{formatDateRange(d.startDate, d.endDate)} ({d.tripDays} hari)</Kv>
        {d.details && <Kv k="Uraian tugas">{pdfSafe(d.details)}</Kv>}

        <View wrap={false}>
          <Text style={s.section}>UANG HARIAN</Text>
          <Text style={[s.p, { color: MUTED }]}>Surat tugas ini menjadi dasar pemberian Uang Harian. Penyerahan uang dibuktikan dengan Bukti Penerimaan Uang Harian yang diterbitkan terpisah (bukan bagian dari slip gaji).</Text>
          <View style={s.th}><Text style={s.cNo}>No</Text><Text style={s.cName}>Nama</Text><Text style={s.cDays}>Hari</Text><Text style={s.cRate}>Tarif / hari</Text><Text style={s.cTotal}>Jumlah</Text></View>
          {d.assignees.map((a, i) => (
            <View key={a.employeeId} style={s.tr}><Text style={s.cNo}>{i + 1}</Text><Text style={s.cName}>{pdfSafe(a.name)}</Text><Text style={s.cDays}>{a.days}</Text><Text style={s.cRate}>{rp(a.dailyRate)}</Text><Text style={s.cTotal}>{rp(a.total)}</Text></View>
          ))}
          <View style={s.trTotal}><Text style={s.cNo} /><Text style={s.cName}>Total uang harian</Text><Text style={s.cDays} /><Text style={s.cRate} /><Text style={s.cTotal}>{rp(total)}</Text></View>
        </View>

        <Text style={[s.p, { marginTop: 8 }]}>Demikian surat tugas ini dibuat untuk dilaksanakan dengan penuh tanggung jawab dan dilaporkan setelah tugas selesai.</Text>

        {d.signer
          ? <SignerBlock signer={d.signer} date={d.issueDate} signature={item.signature} font={FONT} sig={SIG} />
          : <View style={{ marginTop: 8, alignItems: "flex-end" }} wrap={false}><View style={{ width: 190, alignItems: "center" }}><Text>{formatDateLong(d.issueDate)}</Text><View style={{ height: SIG, marginTop: 2 }} /><Text style={{ borderTopWidth: 0.8, borderTopColor: INK, width: "100%", textAlign: "center", paddingTop: 2 }}>( ............................ )</Text></View></View>}

        <View style={s.footer} fixed>
          {d.footerNote && <Text>{pdfSafe(d.footerNote)}</Text>}
          <Text>Dokumen resmi {pdfSafe(d.company.name)}. Dihasilkan oleh sistem HRIS pada {pdfSafe(item.printedAt)}.</Text>
        </View>
      </Page>
    </Document>
  );
}

export interface ReceiptPdfInput { snapshot: ReceiptSnapshot; logo: PdfImage | null; signature: PdfImage | null; voided: boolean; printedAt: string }

const r = StyleSheet.create({
  amountBox: { marginTop: 4, backgroundColor: "#fff1f1", borderWidth: 1, borderColor: "#ffc2c4", borderRadius: 3, padding: 9 },
  amount: { fontFamily: "Helvetica-Bold", fontSize: 18, lineHeight: 1.2, color: RED, marginBottom: 6 },
  terbilang: { fontFamily: "Helvetica-Oblique", color: MUTED, lineHeight: 1.3 },
  signRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 12 },
  materai: { width: 70, height: 38, borderWidth: 0.8, borderColor: MUTED, borderStyle: "dashed", alignItems: "center", justifyContent: "center", marginTop: 2 },
});

/**
 * BUKTI PENERIMAAN UANG HARIAN — satu dokumen per perjalanan per penerima, berdiri sendiri DI LUAR slip gaji.
 * Blok tanda tangan resmi (kanan) SAMA dengan slip gaji; kotak Penerima (kiri) untuk tanda tangan basah karyawan.
 */
export function ReceiptDocument({ item }: { item: ReceiptPdfInput }) {
  const d = item.snapshot;
  const materai = needsMaterai(d.total);
  /** Jumlah baris keterangan di atas gambar tanda tangan resmi (kota+tanggal, jabatan) — dipakai menyejajarkan kotak Penerima. */
  const signerLines = d.signer?.title ? 2 : 1;
  return (
    <Document title={pdfSafe(`Bukti Penerimaan Uang Harian ${d.number}`)} author={pdfSafe(d.company.name)} creator="Trilogika HRIS">
      <Page size="A4" style={s.page}>
        {item.voided && <Text style={s.watermark} fixed>DIBATALKAN</Text>}
        <Letterhead company={d.company} logo={item.logo} />
        <View style={s.titleWrap}>
          <Text style={s.title}>BUKTI PENERIMAAN UANG HARIAN</Text>
          <Text style={s.number}>Nomor: {pdfSafe(d.number)}</Text>
        </View>

        <Text style={s.p}>Telah diterima dari {pdfSafe(d.company.name)} uang sebesar:</Text>
        <View style={r.amountBox} wrap={false}>
          <Text style={r.amount}>{rp(d.total)}</Text>
          <Text style={r.terbilang}>Terbilang: {terbilang(d.total)}</Text>
        </View>

        <Text style={s.section}>PENERIMA</Text>
        <Kv k="Nama">{pdfSafe(d.employee.name)}</Kv>
        <Kv k="No. Induk">{pdfSafe(d.employee.employeeNo)}</Kv>
        <Kv k="Jabatan">{pdfSafe(d.employee.position)}{d.employee.division ? ` — ${pdfSafe(d.employee.division)}` : ""}</Kv>

        <Text style={s.section}>UNTUK KEPERLUAN</Text>
        <Kv k="Uang harian perjalanan">{pdfSafe(d.letter.purpose)}</Kv>
        <Kv k="Lokasi tujuan">{pdfSafe(d.letter.destination)}</Kv>
        <Kv k="Waktu pelaksanaan">{formatDateRange(d.letter.startDate, d.letter.endDate)} ({d.letter.tripDays} hari)</Kv>
        <Kv k="Dasar penugasan">Surat Tugas No. {pdfSafe(d.letter.number)}, tanggal {formatDateLong(d.letter.issueDate)}</Kv>

        <Text style={s.section}>RINCIAN</Text>
        <Kv k="Perhitungan">{d.days} hari x {rp(d.dailyRate)} = {rp(d.total)}</Kv>
        <Kv k="Cara pembayaran">{d.method === "CASH" ? "Tunai" : "Transfer bank"}{d.method === "TRANSFER" && d.employee.bankAccountMasked ? ` — ${pdfSafe(`${d.employee.bankName ?? ""} ${d.employee.bankAccountMasked}`.trim())}` : ""}</Kv>
        <Kv k="Tanggal penyerahan">{formatDateLong(d.paidDate)}</Kv>
        {d.note && <Kv k="Catatan">{pdfSafe(d.note)}</Kv>}

        <Text style={[s.p, { marginTop: 10, color: MUTED }]}>Dokumen ini berdiri sendiri dan bukan bagian dari slip gaji. Uang harian ini tidak termasuk komponen gaji.</Text>

        <View style={r.signRow} wrap={false}>
          {/* Kiri: penerima (tanda tangan basah) — tinggi & garis nama disejajarkan dengan blok penanda tangan resmi di kanan. */}
          <View style={{ width: 190, alignItems: "center", marginTop: 8 }}>
            {signerLines > 1 && <View style={{ height: (signerLines - 1) * FONT * 1.35 }} />}
            <Text>Penerima,</Text>
            {materai
              ? <View style={r.materai}><Text style={{ fontSize: 7, color: MUTED }}>Meterai</Text><Text style={{ fontSize: 7, color: MUTED }}>Rp 10.000</Text></View>
              : null}
            <View style={{ height: materai ? SIG - 38 - 2 : SIG, marginTop: 2 }} />
            <Text style={{ fontFamily: "Helvetica-Bold", marginTop: 1, paddingTop: 2, borderTopWidth: 0.8, borderTopColor: INK, width: "100%", textAlign: "center" }}>{pdfSafe(d.employee.name)}</Text>
          </View>
          {/* Kanan: blok penanda tangan resmi lembaga (identik dengan slip gaji). */}
          {d.signer
            ? <SignerBlock signer={d.signer} date={d.paidDate} signature={item.signature} font={FONT} sig={SIG} />
            : <View style={{ width: 190, alignItems: "center" }}><Text>{formatDateLong(d.paidDate)}</Text><View style={{ height: SIG, marginTop: 2 }} /><Text style={{ borderTopWidth: 0.8, borderTopColor: INK, width: "100%", textAlign: "center", paddingTop: 2 }}>( ............................ )</Text></View>}
        </View>

        <View style={s.footer} fixed>
          {d.footerNote && <Text>{pdfSafe(d.footerNote)}</Text>}
          <Text>Dokumen rahasia untuk penerima yang tercantum. Dihasilkan oleh sistem HRIS pada {pdfSafe(item.printedAt)}.</Text>
        </View>
      </Page>
    </Document>
  );
}
