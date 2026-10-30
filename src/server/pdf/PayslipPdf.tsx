import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfSafe } from "./ReportPdf";
import type { PayslipLine, PayslipSnapshot } from "@/lib/payslip";
import { formatRupiah } from "@/lib/money";
import { terbilang } from "@/lib/terbilang";
import { formatDateLong, formatDateRange, formatDuration } from "@/lib/format";
import { EMPLOYMENT_LABEL } from "@/lib/labels";

Font.registerHyphenationCallback((word) => [word]);

const RED = "#c8202b";
const INK = "#151515";
const MUTED = "#6b6760";
const LINE = "#e4e1dc";

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 60, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9.5, color: INK, lineHeight: 1.35 },
  head: { flexDirection: "row", alignItems: "center", paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: RED },
  logo: { width: 52, height: 52, marginRight: 12, objectFit: "contain" },
  company: { fontFamily: "Helvetica-Bold", fontSize: 14 },
  tagline: { color: RED, fontSize: 8.5, marginTop: 1 },
  meta: { color: MUTED, fontSize: 8, marginTop: 3 },
  titleWrap: { alignItems: "center", marginTop: 16, marginBottom: 12 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 17, letterSpacing: 2 },
  sub: { marginTop: 3, color: MUTED, fontSize: 9 },
  box: { borderWidth: 0.8, borderColor: LINE, borderRadius: 3, padding: 9, flexDirection: "row" },
  col: { flex: 1 },
  kv: { flexDirection: "row", marginBottom: 2.5 },
  k: { width: 78, color: MUTED },
  v: { flex: 1, fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, marginTop: 14, marginBottom: 4, color: RED },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3, fontFamily: "Helvetica-Bold" },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 3.5 },
  trTotal: { flexDirection: "row", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  name: { flex: 1, paddingRight: 8 },
  formula: { color: MUTED, fontSize: 7.5, marginTop: 1 },
  amount: { width: 100, textAlign: "right" },
  net: { marginTop: 14, backgroundColor: "#fff1f1", borderWidth: 1, borderColor: "#ffc2c4", borderRadius: 3, padding: 10 },
  netRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  netLabel: { fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  netValue: { fontFamily: "Helvetica-Bold", fontSize: 15, color: RED },
  terbilang: { marginTop: 4, fontFamily: "Helvetica-Oblique", color: MUTED, fontSize: 8.5 },
  attGrid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 0.8, borderColor: LINE, borderRadius: 3, padding: 6 },
  attCell: { width: "25%", padding: 3 },
  attLabel: { color: MUTED, fontSize: 7.5 },
  attVal: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  note: { marginTop: 10, padding: 8, borderLeftWidth: 2, borderLeftColor: RED, backgroundColor: "#f6f5f3", fontSize: 8.5 },
  footer: { position: "absolute", left: 40, right: 40, bottom: 26, fontSize: 7.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 5 },
  watermark: { position: "absolute", top: 330, left: 60, fontSize: 80, color: "#d8d4cd", transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold", opacity: 0.55 },
});

const rp = (n: number) => formatRupiah(n, "PLAIN");

export interface PayslipPdfItem {
  snapshot: PayslipSnapshot;
  logo: { data: Buffer; mimeType: string } | null;
  voided: boolean;
  printedAt: string;
}

function LineTable({ title, lines, total, totalLabel }: { title: string; lines: PayslipLine[]; total: number; totalLabel: string }) {
  return (
    <View wrap={false}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.th}><Text style={s.name}>Komponen</Text><Text style={s.amount}>Jumlah</Text></View>
      {lines.length === 0 && <View style={s.tr}><Text style={[s.name, { color: MUTED }]}>— tidak ada —</Text><Text style={s.amount}>{rp(0)}</Text></View>}
      {lines.map((l, i) => (
        <View key={i} style={s.tr} wrap={false}>
          <View style={s.name}>
            <Text>{pdfSafe(l.name)}</Text>
            {(l.formula || l.note) && <Text style={s.formula}>{pdfSafe([l.formula, l.note ? `Ket: ${l.note}` : null].filter(Boolean).join(" | "))}</Text>}
          </View>
          <Text style={s.amount}>{rp(l.amount)}</Text>
        </View>
      ))}
      <View style={s.trTotal}><Text style={s.name}>{totalLabel}</Text><Text style={s.amount}>{rp(total)}</Text></View>
    </View>
  );
}

function SlipPage({ item }: { item: PayslipPdfItem }) {
  const d = item.snapshot;
  const a = d.attendance;
  const logoSrc = item.logo ? `data:${item.logo.mimeType};base64,${item.logo.data.toString("base64")}` : null;
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
        <Text style={s.sub}>Tanggal terbit: {formatDateLong(d.issueDate)}</Text>
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

      <LineTable title="PENDAPATAN" lines={d.earnings} total={d.totalEarnings} totalLabel="Total Pendapatan" />
      <LineTable title="POTONGAN" lines={d.deductions} total={d.totalDeductions} totalLabel="Total Potongan" />

      <View style={s.net} wrap={false}>
        <View style={s.netRow}><Text style={s.netLabel}>GAJI BERSIH DITERIMA</Text><Text style={s.netValue}>{rp(d.netPay)}</Text></View>
        {d.netPay >= 0 && <Text style={s.terbilang}>Terbilang: {terbilang(d.netPay)}</Text>}
      </View>

      {a && (
        <View wrap={false}>
          <Text style={s.sectionTitle}>RINGKASAN KEHADIRAN ({formatDateRange(d.attendanceBasis.start, d.attendanceBasis.end)})</Text>
          <View style={s.attGrid}>
            {[
              ["Hari kerja terjadwal", `${a.scheduledDays}`],
              ["Hadir", `${a.presentDays}`],
              ["Terlambat", `${a.lateCount}x (${formatDuration(a.lateMinutes)})`],
              ["Tidak hadir", `${a.absentDays}`],
              ["Izin", `${a.izinDays}`],
              ["Sakit", `${a.sakitDays}`],
              ["Cuti", `${a.cutiDays}`],
              ["Jam kerja tercatat", formatDuration(a.workedMinutes)],
            ].map(([k, v]) => (
              <View key={k} style={s.attCell}><Text style={s.attLabel}>{k}</Text><Text style={s.attVal}>{v}</Text></View>
            ))}
          </View>
        </View>
      )}

      {(d.note || d.revisionNote) && (
        <View style={s.note} wrap={false}>
          {d.note && <Text>Catatan: {pdfSafe(d.note)}</Text>}
          {d.revisionNote && <Text style={{ marginTop: d.note ? 3 : 0 }}>{pdfSafe(d.revisionNote)}</Text>}
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
