import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfSafe } from "./ReportPdf";
import type { PayslipLine, PayslipSnapshot } from "@/lib/payslip";
import { formatRupiah } from "@/lib/money";
import { terbilang } from "@/lib/terbilang";
import { formatDateLong, formatDateRange, formatDuration, formatDays } from "@/lib/format";
import { EMPLOYMENT_LABEL } from "@/lib/labels";

Font.registerHyphenationCallback((word) => [word]);

const RED = "#c8202b";
const INK = "#151515";
const MUTED = "#6b6760";
const LINE = "#e4e1dc";

/**
 * Tingkat kepadatan: slip HARUS satu halaman. Tingkat dipilih dari perkiraan tinggi isi (`pickTier`); makin banyak baris
 * komponen, makin rapat spasi & font — tanpa memotong isi. Tingkat A = bawaan (rapi), C = paling padat.
 */
interface Tier { inline: boolean; font: number; trPad: number; formula: number; secMT: number; secFont: number; logo: number; companyFont: number; titleFont: number; titleMT: number; boxPad: number; netValue: number; netPad: number; attVal: number; sig: number; noteMin: number }
const TIERS: Tier[] = [
  { inline: false, font: 9,   trPad: 1.9, formula: 7.2, secMT: 8, secFont: 9.5, logo: 48, companyFont: 14,   titleFont: 16, titleMT: 10, boxPad: 8, netValue: 14, netPad: 8, attVal: 9.5, sig: 40, noteMin: 30 },
  { inline: false, font: 8.5, trPad: 1.1, formula: 6.8, secMT: 6, secFont: 9,   logo: 42, companyFont: 13,   titleFont: 15, titleMT: 7,  boxPad: 6, netValue: 13, netPad: 6, attVal: 9,   sig: 34, noteMin: 26 },
  // Tingkat 2+: keterangan hitungan dipindah ke BARIS YANG SAMA dengan nama komponen (hemat ±9 pt per baris).
  { inline: true,  font: 8.5, trPad: 0.9, formula: 6.8, secMT: 6, secFont: 9,   logo: 40, companyFont: 13,   titleFont: 15, titleMT: 6,  boxPad: 6, netValue: 13, netPad: 6, attVal: 9,   sig: 32, noteMin: 24 },
  { inline: true,  font: 8,   trPad: 0.4, formula: 6.5, secMT: 5, secFont: 8.5, logo: 36, companyFont: 12.5, titleFont: 14, titleMT: 5,  boxPad: 5, netValue: 12, netPad: 5, attVal: 8.5, sig: 26, noteMin: 20 },
];

const makeStyles = (t: Tier) => StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 52, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: t.font, color: INK, lineHeight: 1.3 },
  head: { flexDirection: "row", alignItems: "center", paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: RED },
  logo: { width: t.logo, height: t.logo, marginRight: 12, objectFit: "contain" },
  company: { fontFamily: "Helvetica-Bold", fontSize: t.companyFont },
  // Tagline diturunkan dari nama lembaga agar proporsional (jarak 4.5 pt, bukan 1 pt).
  tagline: { color: RED, fontSize: 8.5, marginTop: 4.5 },
  meta: { color: MUTED, fontSize: 8, marginTop: 4.5 },
  titleWrap: { alignItems: "center", marginTop: t.titleMT + 2, marginBottom: t.titleMT },
  title: { fontFamily: "Helvetica-Bold", fontSize: t.titleFont, letterSpacing: 2, lineHeight: 1.15 },
  // Jarak judul "SLIP GAJI" ke baris periode dilonggarkan (sebelumnya 3 pt → 8 pt).
  sub: { marginTop: 8, color: MUTED, fontSize: t.font },
  sub2: { marginTop: 2, color: MUTED, fontSize: t.font },
  box: { borderWidth: 0.8, borderColor: LINE, borderRadius: 3, padding: t.boxPad, flexDirection: "row" },
  col: { flex: 1 },
  kv: { flexDirection: "row", marginBottom: 1.5 },
  k: { width: 74, color: MUTED },
  v: { flex: 1, fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: t.secFont, marginTop: t.secMT, marginBottom: 2.5, color: RED },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 2, fontFamily: "Helvetica-Bold" },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: t.trPad },
  trTotal: { flexDirection: "row", paddingVertical: t.trPad + 1.2, fontFamily: "Helvetica-Bold" },
  name: { flex: 1, paddingRight: 8 },
  formula: { color: MUTED, fontSize: t.formula, marginTop: 0.5 },
  amount: { width: 100, textAlign: "right" },
  net: { marginTop: t.secMT + 1, backgroundColor: "#fff1f1", borderWidth: 1, borderColor: "#ffc2c4", borderRadius: 3, padding: t.netPad },
  netRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  netLabel: { fontFamily: "Helvetica-Bold", fontSize: t.font + 1 },
  netValue: { fontFamily: "Helvetica-Bold", fontSize: t.netValue, color: RED },
  terbilang: { marginTop: 2, fontFamily: "Helvetica-Oblique", color: MUTED, fontSize: t.font - 0.5 },
  attGrid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 0.8, borderColor: LINE, borderRadius: 3, padding: 4 },
  attCell: { width: "20%", padding: 2.5 },
  attLabel: { color: MUTED, fontSize: 7 },
  attVal: { fontFamily: "Helvetica-Bold", fontSize: t.attVal },
  // Kolom "Catatan" (motivasi / peringatan) — selalu tampil di bawah, di atas tanda tangan.
  catatan: { marginTop: t.secMT + 2, borderWidth: 0.8, borderColor: LINE, borderLeftWidth: 2.5, borderLeftColor: RED, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 8, minHeight: t.noteMin, backgroundColor: "#faf9f7" },
  catatanLabel: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: RED, marginBottom: 1.5 },
  catatanText: { fontSize: t.font },
  revision: { marginTop: 2, color: MUTED, fontSize: 7.5 },
  signWrap: { marginTop: 8, alignItems: "flex-end" },
  sign: { width: 190, alignItems: "center" },
  signMeta: { fontSize: t.font },
  signImg: { height: t.sig, width: 150, objectFit: "contain", marginTop: 2 },
  signGap: { height: t.sig, marginTop: 2 },
  signName: { fontFamily: "Helvetica-Bold", marginTop: 1, paddingTop: 2, borderTopWidth: 0.8, borderTopColor: INK, width: "100%", textAlign: "center" },
  footer: { position: "absolute", left: 40, right: 40, bottom: 22, fontSize: 7.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 4 },
  watermark: { position: "absolute", top: 330, left: 60, fontSize: 80, color: "#d8d4cd", transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold", opacity: 0.55 },
});
const STYLES = TIERS.map(makeStyles);
type Styles = ReturnType<typeof makeStyles>;

const rp = (n: number) => formatRupiah(n, "PLAIN");

/** Tinggi area isi A4 (842 pt − padding atas 30 − padding bawah 52) dikurangi cadangan keamanan. */
const CONTENT_BUDGET = 842 - 30 - 52 - 8;

/** Perkiraan tinggi isi slip (pt) pada satu tingkat kepadatan. Heuristik — diverifikasi oleh tes dengan merender PDF sungguhan. */
export function estimateSlipHeight(d: PayslipSnapshot, tier: number): number {
  const t = TIERS[tier]!;
  const lh = 1.3;
  const wrapLines = (txt: string, charsPerLine: number) => Math.max(1, Math.ceil(txt.length / charsPerLine));
  const row = (l: PayslipLine) => {
    const f = [l.formula, l.note ? `Ket: ${l.note}` : null].filter(Boolean).join(" | ");
    if (t.inline) {
      // Lebar kolom nama ≈ 405 pt; lebar rata-rata karakter ≈ 0,52 em. Muat satu baris? bila tidak, dua baris.
      const width = l.name.length * 0.52 * t.font + (f ? 18 + f.length * 0.5 * t.formula : 0);
      return t.font * lh * Math.max(1, Math.ceil(width / 405)) + 2 * t.trPad + 0.5;
    }
    return t.font * lh * wrapLines(l.name, 60) + 2 * t.trPad + 0.5 + (f ? (t.formula * lh + 0.5) * wrapLines(f, Math.floor(105 * (7.5 / t.formula))) : 0);
  };
  const table = (lines: PayslipLine[], header: boolean) => t.secMT + t.secFont * lh + 2.5 + (header ? t.font * lh + 3 : 0) + (lines.length ? lines.reduce((a, l) => a + row(l), 0) : t.font * lh + 2 * t.trPad) + (t.font * lh + 2 * (t.trPad + 1.2));
  const head = Math.max(t.logo, t.companyFont * lh + 8.5 * lh + 8 * lh + 9) + 8 + 2;
  const title = t.titleMT * 2 + 2 + t.titleFont * 1.15 + 8 + t.font * lh * 2 + 2;
  const box = 2 * t.boxPad + 3 * (t.font * lh + 1.5) + 2;
  const net = t.secMT + 1 + 2 * t.netPad + (t.font + 1) * lh + 4 + (t.font - 0.5) * lh * (d.netPay >= 0 ? wrapLines(`Terbilang: ${terbilang(d.netPay)}`, Math.floor(100 * (9 / t.font))) : 0);
  const employer = d.employerContributions?.length ? t.secMT + t.secFont * lh + 2.5 + Math.ceil(d.employerContributions.length / 2) * (t.font * lh + 1.2) : 0;
  const att = d.attendance ? t.secMT + t.secFont * lh + 2.5 + 8 + Math.ceil((d.overtimePaidMinutes != null ? 9 : 8) / 5) * (7 * lh + t.attVal * lh + 5) : 0;
  const noteLines = Math.max(2, Math.ceil((d.note ?? "").length / Math.floor(105 * (9 / t.font)))) + (d.revisionNote ? 1.4 : 0);
  const catatan = t.secMT + 2 + 10 + 7.5 * lh + 1.5 + noteLines * t.font * lh + 2;
  const sign = d.signer ? 8 + t.font * lh * (d.signer.title ? 2 : 1) + t.sig + 4 + 6 + (t.font + 0.5) * lh + 4 : 0;
  return head + title + box + table(d.earnings, true) + table(d.deductions, false) + net + employer + att + catatan + sign;
}

/** Tingkat terlonggar yang masih muat satu halaman; bila tidak ada yang cukup, tingkat terpadat (slip ekstrem boleh meluber). */
export function pickTier(d: PayslipSnapshot): number {
  for (let i = 0; i < TIERS.length; i++) if (estimateSlipHeight(d, i) <= CONTENT_BUDGET) return i;
  return TIERS.length - 1;
}

export interface PayslipPdfItem {
  snapshot: PayslipSnapshot;
  logo: { data: Buffer; mimeType: string } | null;
  /** Gambar tanda tangan penanda tangan (dari snapshot.signer.signatureFileId); null = ruang kosong untuk tanda tangan basah. */
  signature?: { data: Buffer; mimeType: string } | null;
  voided: boolean;
  printedAt: string;
  /** Hanya untuk uji/kalibrasi: paksa tingkat kepadatan (0–2). */
  forceTier?: number;
}

function LineTable({ st: s, inline, title, lines, total, totalLabel, header = true }: { st: Styles; inline: boolean; title: string; lines: PayslipLine[]; total: number; totalLabel: string; header?: boolean }) {
  return (
    <View wrap={false}>
      <Text style={s.sectionTitle}>{title}</Text>
      {header && <View style={s.th}><Text style={s.name}>Komponen</Text><Text style={s.amount}>Jumlah</Text></View>}
      {lines.length === 0 && <View style={s.tr}><Text style={[s.name, { color: MUTED }]}>— tidak ada —</Text><Text style={s.amount}>{rp(0)}</Text></View>}
      {lines.map((l, i) => {
        const f = [l.formula, l.note ? `Ket: ${l.note}` : null].filter(Boolean).join(" | ");
        return (
          <View key={i} style={s.tr} wrap={false}>
            {inline ? (
              <Text style={s.name}>{pdfSafe(l.name)}{f ? <Text style={s.formula}>{"   "}{pdfSafe(f)}</Text> : null}</Text>
            ) : (
              <View style={s.name}>
                <Text>{pdfSafe(l.name)}</Text>
                {f && <Text style={s.formula}>{pdfSafe(f)}</Text>}
              </View>
            )}
            <Text style={s.amount}>{rp(l.amount)}</Text>
          </View>
        );
      })}
      <View style={s.trTotal}><Text style={s.name}>{totalLabel}</Text><Text style={s.amount}>{rp(total)}</Text></View>
    </View>
  );
}

function SlipPage({ item }: { item: PayslipPdfItem }) {
  const d = item.snapshot;
  const a = d.attendance;
  const tier = item.forceTier ?? pickTier(d);
  const s = STYLES[tier]!;
  const logoSrc = item.logo ? `data:${item.logo.mimeType};base64,${item.logo.data.toString("base64")}` : null;
  const sigSrc = item.signature ? `data:${item.signature.mimeType};base64,${item.signature.data.toString("base64")}` : null;
  const sg = d.signer ?? null;
  return (
    <Page size="A4" style={s.page}>
      {item.voided && <Text style={s.watermark} fixed>DIBATALKAN</Text>}
      <View style={s.head}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
        {logoSrc && <Image src={logoSrc} style={s.logo} />}
        <View style={{ flex: 1 }}>
          <Text style={s.company}>{pdfSafe(d.company.name)}</Text>
          {d.company.tagline && <Text style={s.tagline}>{pdfSafe(d.company.tagline)}</Text>}
          <Text style={s.meta}>{pdfSafe([d.company.address, d.company.phone, d.company.email].filter(Boolean).join("  |  "))}</Text>
        </View>
      </View>

      <View style={s.titleWrap}>
        <Text style={s.title}>SLIP GAJI</Text>
        <Text style={s.sub}>Periode {formatDateRange(d.period.start, d.period.end)}  |  No. {d.number}</Text>
        <Text style={s.sub2}>Tanggal terbit: {formatDateLong(d.issueDate)}</Text>
      </View>

      <View style={s.box}>
        <View style={s.col}>
          <View style={s.kv}><Text style={s.k}>Nama</Text><Text style={s.v}>{pdfSafe(d.employee.name)}</Text></View>
          <View style={s.kv}><Text style={s.k}>No. Induk</Text><Text style={s.v}>{pdfSafe(d.employee.employeeNo)}</Text></View>
          <View style={s.kv}><Text style={s.k}>Jabatan</Text><Text style={s.v}>{pdfSafe(d.employee.position)}</Text></View>
        </View>
        <View style={s.col}>
          <View style={s.kv}><Text style={s.k}>Divisi</Text><Text style={s.v}>{pdfSafe(d.employee.division ?? "-")}</Text></View>
          <View style={s.kv}><Text style={s.k}>Status</Text><Text style={s.v}>{EMPLOYMENT_LABEL[d.employee.employmentStatus]}</Text></View>
          <View style={s.kv}><Text style={s.k}>Rekening</Text><Text style={s.v}>{pdfSafe(d.employee.bankAccountMasked ? `${d.employee.bankName ?? ""} ${d.employee.bankAccountMasked}`.trim() : "-")}</Text></View>
        </View>
      </View>

      <LineTable st={s} inline={TIERS[tier]!.inline} title="PENDAPATAN" lines={d.earnings} total={d.totalEarnings} totalLabel="Total Pendapatan" />
      <LineTable st={s} inline={TIERS[tier]!.inline} title="POTONGAN" lines={d.deductions} total={d.totalDeductions} totalLabel="Total Potongan" header={false} />

      <View style={s.net} wrap={false}>
        <View style={s.netRow}><Text style={s.netLabel}>GAJI BERSIH DITERIMA</Text><Text style={s.netValue}>{rp(d.netPay)}</Text></View>
        {d.netPay >= 0 && <Text style={s.terbilang}>Terbilang: {terbilang(d.netPay)}</Text>}
      </View>

      {d.employerContributions && d.employerContributions.length > 0 && (
        <View wrap={false}>
          <Text style={s.sectionTitle}>BEBAN PERUSAHAAN (INFORMASI - TIDAK DIPOTONG DARI GAJI)</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {d.employerContributions.map((l) => (
              <View key={l.name} style={{ width: "50%", flexDirection: "row", justifyContent: "space-between", paddingVertical: 0.6, paddingRight: 12 }}><Text>{pdfSafe(l.name)}</Text><Text>{rp(l.amount)}</Text></View>
            ))}
          </View>
        </View>
      )}

      {a && (
        <View wrap={false}>
          <Text style={s.sectionTitle}>RINGKASAN KEHADIRAN ({formatDateRange(d.attendanceBasis.start, d.attendanceBasis.end)})</Text>
          <View style={s.attGrid}>
            {[
              ["Hari kerja terjadwal", `${formatDays(a.scheduledDays)}`],
              ["Hadir", `${formatDays(a.presentDays)}`],
              ["Terlambat", `${a.lateCount}x (${formatDuration(a.lateMinutes)})`],
              ["Tidak hadir", `${formatDays(a.absentDays)}`],
              ["Izin", `${formatDays(a.izinDays)}`],
              ["Sakit", `${formatDays(a.sakitDays)}`],
              ["Cuti", `${formatDays(a.cutiDays)}`],
              ["Jam kerja tercatat", formatDuration(a.workedMinutes)],
              ...(d.overtimePaidMinutes != null ? [["Lembur dibayar", d.overtimePaidMinutes > 0 ? formatDuration(d.overtimePaidMinutes) : "-"]] : []),
            ].map(([k, v]) => (
              <View key={k} style={s.attCell}><Text style={s.attLabel}>{k}</Text><Text style={s.attVal}>{v}</Text></View>
            ))}
          </View>
        </View>
      )}

      {/* Catatan untuk karyawan (motivasi / peringatan) — diisi HR per karyawan pada item penggajian; selalu tampil, di atas tanda tangan. */}
      <View style={s.catatan} wrap={false}>
        <Text style={s.catatanLabel}>CATATAN</Text>
        <Text style={s.catatanText}>{d.note ? pdfSafe(d.note) : "-"}</Text>
        {d.revisionNote && <Text style={s.revision}>{pdfSafe(d.revisionNote)}</Text>}
      </View>

      {sg && (
        <View style={s.signWrap} wrap={false}>
          <View style={s.sign}>
            <Text style={s.signMeta}>{pdfSafe([sg.place, formatDateLong(d.issueDate)].filter(Boolean).join(", "))}</Text>
            {sg.title && <Text style={s.signMeta}>{pdfSafe(sg.title)}</Text>}
            {/* eslint-disable-next-line jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
            {sigSrc ? <Image src={sigSrc} style={s.signImg} /> : <View style={s.signGap} />}
            <Text style={s.signName}>{pdfSafe(sg.name)}</Text>
          </View>
        </View>
      )}

      <View style={s.footer} fixed>
        {d.footerNote && <Text>{pdfSafe(d.footerNote)}</Text>}
        <Text>Dokumen rahasia untuk penerima yang tercantum. Dihasilkan oleh sistem HRIS pada {pdfSafe(item.printedAt)}.</Text>
      </View>
    </Page>
  );
}

export function PayslipDocument({ items }: { items: PayslipPdfItem[] }) {
  const first = items[0]?.snapshot;
  return (
    <Document title={pdfSafe(first ? `Slip Gaji ${first.employee.name} ${first.period.label}` : "Slip Gaji")} author={pdfSafe(first?.company.name ?? "Trilogika Edutama")} creator="Trilogika HRIS">
      {items.map((it, i) => <SlipPage key={i} item={it} />)}
    </Document>
  );
}
