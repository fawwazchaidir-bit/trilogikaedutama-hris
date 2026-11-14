import { Document, Font, Image, Page, StyleSheet, Text as PdfText, View, type TextProps } from "@react-pdf/renderer";
import type { PropsWithChildren } from "react";
import path from "node:path";
import type { PmDoc, PmNode } from "@/lib/documents/content";
import type { DocFrame, DocImage, DocSignatory } from "@/lib/documents/frame";
import { diktumLabel, listMarker, longDate, type ListStyle } from "@/lib/documents/text";

/**
 * RENDERER PDF DOKUMEN (persuratan): membaca JSON isi + bingkai dan menghasilkan PDF A4.
 * Isi surat: Liberation Serif (metrik Times New Roman). Kop surat dan layout EDARAN: Caladea (metrik Cambria). Keduanya lisensi OFL, di-embed dari public/fonts.
 * Cambria adalah font berlisensi Microsoft sehingga tidak dibundel; Caladea dirancang metrik-kompatibel dengannya (lebar glif sama → tata letak identik di Word).
 */
const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const F = "LiberationSerif";
const C = "Caladea"; // pengganti Cambria (metrik sama)
Font.register({
  family: C,
  fonts: [
    { src: path.join(FONT_DIR, "Caladea-Regular.ttf") },
    { src: path.join(FONT_DIR, "Caladea-Bold.ttf"), fontWeight: "bold" },
    { src: path.join(FONT_DIR, "Caladea-Italic.ttf"), fontStyle: "italic" },
    { src: path.join(FONT_DIR, "Caladea-BoldItalic.ttf"), fontWeight: "bold", fontStyle: "italic" },
  ],
});
Font.register({
  family: F,
  fonts: [
    { src: path.join(FONT_DIR, "LiberationSerif-Regular.ttf") },
    { src: path.join(FONT_DIR, "LiberationSerif-Bold.ttf"), fontWeight: "bold" },
    { src: path.join(FONT_DIR, "LiberationSerif-Italic.ttf"), fontStyle: "italic" },
    { src: path.join(FONT_DIR, "LiberationSerif-BoldItalic.ttf"), fontWeight: "bold", fontStyle: "italic" },
  ],
});
Font.registerHyphenationCallback((w) => [w]);

const CM = 28.3465; // pt per cm
const BASE = 11;
const LINE = 1.3;
/**
 * Tinggi baris isi dalam SATUAN pt, dipasang per teks lewat <Text> di bawah — BUKAN `lineHeight` pada Page. Dua alasan (diuji): (1) `lineHeight` di level Page membuat teks `render`
 * pada elemen `fixed` (nomor halaman) tidak tercetak, sehingga seluruh kaki halaman hilang; (2) pengali `lineHeight` pada Text yang ukuran hurufnya diwariskan dihitung terhadap 18 pt bawaan.
 */
const lineCtx = (size: number, mult: number) => `${(size * mult).toFixed(2)}pt`;
/** Tata letak isi per layout: tinggi baris (pt) dan jarak bawah daftar (pt). Diteruskan sebagai prop (BUKAN konteks React: `createContext` ditolak di modul sisi-server oleh Next). */
interface Layout { lh: string; listGap: number }
const DEFAULT_LAYOUT: Layout = { lh: lineCtx(BASE, LINE), listGap: 0 };
const EDARAN_LAYOUT: Layout = { lh: lineCtx(12, 1.5), listGap: 12 };
/** <Text> react-pdf dengan tinggi baris isi (pt; bawaan = layout biasa); gaya eksplisit tetap menang. Teks `render`/kaki halaman memakai PdfText langsung. */
function Text({ lh = DEFAULT_LAYOUT.lh, style, ...rest }: PropsWithChildren<TextProps> & { lh?: string }) {
  return <PdfText {...rest} style={[{ lineHeight: lh }, ...(Array.isArray(style) ? style : style ? [style] : [])]} />;
}
const FIRST_LINE = 1.25 * CM;
const src = (img: DocImage | null | undefined) => (img ? `data:${img.mimeType};base64,${img.data.toString("base64")}` : null);

/** Layout EDARAN (Surat Edaran): isi mengikuti contoh Memo Internal Trilogika — Cambria 12 pt, spasi 1,5. */
const EDARAN_PAGE = { fontFamily: C, fontSize: 12 } as const;

const s = StyleSheet.create({
  page: { fontFamily: F, fontSize: BASE, paddingTop: 1.5 * CM, paddingBottom: 2.1 * CM, paddingHorizontal: 2 * CM, color: "#000" },
  kop: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  kopLogo: { width: 78, height: 78, marginRight: 14, objectFit: "contain" },
  kopText: { flex: 1 },
  kopTagline: { fontFamily: C, fontWeight: "bold", fontSize: 12, lineHeight: 1.15 },
  kopName: { fontFamily: C, fontWeight: "bold", fontSize: 14, marginVertical: 1, lineHeight: 1.15 },
  kopAddress: { fontFamily: C, fontStyle: "italic", fontSize: 10, lineHeight: 1.15 },
  rule: { borderBottomWidth: 1.2, borderBottomColor: "#000", marginBottom: 10 },
  idRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  idK: { width: 62, fontWeight: "bold" },
  idV: { fontWeight: "bold" },
  signWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 10 },
  qrBox: { width: 150, alignItems: "flex-start" },
  qr: { width: 74, height: 74 },
  qrCap: { fontSize: 7.5, lineHeight: 1.25, marginTop: 3, width: 140 },
  signBox: { width: 200, alignItems: "center" },
  signArt: { width: 200, height: 82, position: "relative" },
  footerText: { position: "absolute", bottom: 1.2 * CM, fontSize: 8.5 },
  watermark: { position: "absolute", top: 300, left: 70, fontSize: 130, lineHeight: 1.3, color: "#e6e6e6", transform: "rotate(-35deg)", fontWeight: "bold" },
});

type Inline = PmNode;
function runStyle(n: Inline) {
  const m = new Set((n.marks ?? []).map((x) => x.type));
  return { fontWeight: m.has("bold") ? ("bold" as const) : undefined, fontStyle: m.has("italic") ? ("italic" as const) : undefined, textDecoration: m.has("underline") ? ("underline" as const) : undefined };
}
function Runs({ nodes }: { nodes: Inline[] | undefined }) {
  return <>{(nodes ?? []).map((n, k) => (n.type === "hardBreak" ? <PdfText key={k}>{"\n"}</PdfText> : n.type === "text" ? <PdfText key={k} style={runStyle(n)}>{n.text}</PdfText> : null))}</>;
}

const mgn = (cm: unknown) => (typeof cm === "number" ? cm * CM : 0);

function Para({ n, extraIndent = 0, lay }: { n: PmNode; extraIndent?: number; lay: Layout }) {
  const a = n.attrs ?? {};
  const isHeading = n.type === "heading";
  const align = (a.textAlign as "left" | "center" | "right" | "justify" | undefined) ?? "left";
  return (
    <Text
      lh={lay.lh}
      style={{ textAlign: align, marginLeft: mgn(a.indent) + extraIndent, textIndent: a.firstLine ? FIRST_LINE : 0, marginBottom: typeof a.spaceAfter === "number" ? a.spaceAfter : 6, fontWeight: isHeading ? "bold" : undefined, fontSize: isHeading ? BASE + (4 - Number(a.level ?? 3)) : undefined }}
      minPresenceAhead={isHeading ? 40 : undefined}
    >
      <Runs nodes={n.content} />
    </Text>
  );
}

function Blocks({ nodes, indent = 0, lay }: { nodes: PmNode[] | undefined; indent?: number; lay: Layout }) {
  return <>{(nodes ?? []).map((n, k) => <Block key={k} n={n} indent={indent} lay={lay} />)}</>;
}

function Block({ n, indent, lay }: { n: PmNode; indent: number; lay: Layout }) {
  switch (n.type) {
    case "paragraph":
    case "heading":
      return <Para n={n} extraIndent={indent} lay={lay} />;
    case "pageBreak":
      return <View break />;
    case "optionalBlock":
      return n.attrs?.enabled === false ? null : <Blocks nodes={n.content} indent={indent} lay={lay} />;
    case "bulletList":
    case "orderedList": {
      const style = (n.attrs?.style as ListStyle | undefined) ?? "decimal";
      const start = Number(n.attrs?.start ?? 1);
      const left = indent + (n.attrs?.indent !== undefined ? mgn(n.attrs.indent) : 0);
      return (
        <View style={{ marginLeft: left, marginBottom: lay.listGap }}>
          {(n.content ?? []).map((item, k) => (
            <View key={k} style={{ flexDirection: "row", marginBottom: 2 }} wrap={false}>
              <Text lh={lay.lh} style={{ width: 0.9 * CM }}>{n.type === "bulletList" ? "•" : listMarker(style, start + k)}</Text>
              <View style={{ flex: 1 }}><Blocks nodes={item.content} lay={lay} /></View>
            </View>
          ))}
        </View>
      );
    }
    case "labelBlock": {
      const lw = (Number(n.attrs?.labelWidth ?? 3.2)) * CM;
      return (
        <View style={{ marginLeft: indent + mgn(n.attrs?.indent), marginBottom: 6 }}>
          {(n.content ?? []).map((r, k) => (
            <View key={k} style={{ flexDirection: "row", marginBottom: 1 }} wrap={false}>
              <Text lh={lay.lh} style={{ width: lw }}>{String(r.attrs?.label ?? "")}</Text>
              <Text lh={lay.lh} style={{ width: 10 }}>:</Text>
              <Text lh={lay.lh} style={{ flex: 1 }}><Runs nodes={r.content} /></Text>
            </View>
          ))}
        </View>
      );
    }
    case "diktumList": {
      const lw = Number(n.attrs?.labelWidth ?? 2.6) * CM;
      let auto = Number(n.attrs?.autoStart ?? 0);
      // Item dirender langsung (tanpa View pembungkus) agar daftar dapat terpotong antar halaman di antara item.
      return (
        <>
          {(n.content ?? []).map((item, k) => {
            const custom = typeof item.attrs?.label === "string" ? item.attrs.label : null;
            const label = custom ?? diktumLabel(auto++);
            return (
              <View key={k} style={{ flexDirection: "row", marginBottom: 6, marginLeft: indent }}>
                <Text style={{ width: lw, fontWeight: custom ? undefined : "bold" }} minPresenceAhead={30}>{label}</Text>
                <Text style={{ width: 10 }}>:</Text>
                <View style={{ flex: 1 }}><Blocks nodes={item.content} lay={lay} /></View>
              </View>
            );
          })}
        </>
      );
    }
    case "table": {
      const rows = n.content ?? [];
      const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((sum, c) => sum + Number(c.attrs?.colspan ?? 1), 0)));
      const widths = (n.attrs?.colWidths as number[] | undefined) ?? Array.from({ length: cols }, () => 100 / cols);
      return (
        <View style={{ marginLeft: indent, marginBottom: 8, borderTopWidth: 0.6, borderLeftWidth: 0.6 }}>
          {rows.map((r, ri) => (
            <View key={ri} style={{ flexDirection: "row" }} wrap={false}>
              {(r.content ?? []).map((c, ci) => {
                const span = Number(c.attrs?.colspan ?? 1);
                const w = widths.slice(ci, ci + span).reduce((x, y) => x + y, 0);
                const head = c.type === "tableHeader";
                return (
                  <View key={ci} style={{ width: `${w}%`, borderRightWidth: 0.6, borderBottomWidth: 0.6, padding: 3, backgroundColor: head ? "#efefef" : undefined }}>
                    <Blocks nodes={c.content} lay={lay} />
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      );
    }
    default:
      return null;
  }
}

/** Kop surat (format baru): logo di kiri; tiga baris — tagline (Cambria bold 12), nama lembaga (Cambria bold 14), alamat (Cambria italic 10). */
function Kop({ f }: { f: DocFrame }) {
  const l = f.letterhead;
  const logo = src(l.logo);
  return (
    <View>
      <View style={s.kop}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
        {logo ? <Image src={logo} style={s.kopLogo} /> : null}
        <View style={s.kopText}>
          {l.tagline ? <Text style={s.kopTagline}>{l.tagline}</Text> : null}
          <Text style={s.kopName}>{l.name}</Text>
          {l.addressLines.map((x, k) => <Text key={k} style={s.kopAddress}>{x}</Text>)}
        </View>
      </View>
      <View style={s.rule} />
    </View>
  );
}

function Identity({ f }: { f: DocFrame }) {
  const rows: [string, string][] = [["Nomor", f.number ?? "(diberikan saat disetujui)"], ...(f.attachmentText ? [["Lampiran", f.attachmentText] as [string, string]] : []), ...(f.subject ? [["Perihal", f.subject] as [string, string]] : [])];
  return (
    <View style={s.idRow}>
      <View style={{ flex: 1 }}>
        {rows.map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row" }}><Text style={s.idK}>{k}</Text><Text style={s.idV}>: {v}</Text></View>
        ))}
      </View>
      <Text style={{ width: 150, textAlign: "right" }}>{f.place}, {longDate(f.date, true)}</Text>
    </View>
  );
}

function Recipient({ f }: { f: DocFrame }) {
  const r = f.recipient;
  if (!r) return null;
  return (
    <View style={{ marginBottom: 12 }} wrap={false}>
      {r.prefix ? <Text>{r.prefix}</Text> : null}
      {r.lines.map((l, k) => <Text key={k} style={{ fontWeight: l.bold ? "bold" : undefined }}>{l.text}</Text>)}
      {r.cityPrefix ? <Text>{r.cityPrefix}</Text> : null}
      {r.place ? <Text style={{ marginLeft: 0.8 * CM }}>{r.place}</Text> : null}
    </View>
  );
}

function SignatureArt({ sg }: { sg: DocSignatory }) {
  const stamp = src(sg.stamp), sig = src(sg.signature);
  const sp = sg.stampPlacement ?? { x: 4, y: 0, w: 82, h: 82 };
  const gp = sg.signaturePlacement ?? { x: 38, y: 6, w: 130, h: 68 };
  return (
    <View style={s.signArt}>
      {/* eslint-disable jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
      {stamp ? <Image src={stamp} style={{ position: "absolute", left: sp.x, top: sp.y, width: sp.w, height: sp.h, objectFit: "contain" }} /> : null}
      {sig ? <Image src={sig} style={{ position: "absolute", left: gp.x, top: gp.y, width: gp.w, height: gp.h, objectFit: "contain" }} /> : null}
      {/* eslint-enable jsx-a11y/alt-text */}
    </View>
  );
}

/** Blok tanda tangan: QR validasi di kiri; organisasi, jabatan, cap + tanda tangan bertumpuk, dan nama di kanan. Tidak terpotong antar halaman. */
function SignBlock({ f, qr, extra }: { f: DocFrame; qr: string | null; extra?: DocSignatory[] }) {
  const list = extra ?? f.signatories;
  return (
    <View wrap={false} style={s.signWrap}>
      <View style={s.qrBox}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
        {qr ? <Image src={qr} style={s.qr} /> : null}
        {f.verify && qr ? <Text style={s.qrCap}>{f.verify.caption}{f.number ? `\n${f.number}` : ""}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: list.length > 2 ? 2 * 200 + 8 : undefined }}>
        {list.map((sg, k) => (
          <View key={k} style={[s.signBox, list.length > 2 ? { marginBottom: 6 } : {}]}>
            {sg.orgName ? <Text style={{ fontWeight: "bold" }}>{sg.orgName}</Text> : null}
            <Text style={{ fontWeight: "bold" }}>{sg.title}</Text>
            {f.draft || sg.external ? <View style={{ height: 82 }} /> : <SignatureArt sg={sg} />}
            <Text style={{ fontWeight: "bold", textDecoration: "underline" }}>{sg.name || "(.............................)"}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Cc({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: 12 }} wrap={false}>
      <Text style={{ fontWeight: "bold" }}>Tembusan:</Text>
      {items.map((c, k) => <View key={k} style={{ flexDirection: "row" }}><Text style={{ width: 0.9 * CM }}>{k + 1}.</Text><Text style={{ flex: 1 }}>{c}</Text></View>)}
    </View>
  );
}

/** Kaki halaman: teks lembaga (kiri) + "Hal. X dari Y" (kanan). PdfText + keluarga font eksplisit: teks `render` pada elemen `fixed` tidak mewarisi font halaman (Helvetica bawaan). */
function Footer({ f, label }: { f: DocFrame; label?: string }) {
  const fontFamily = f.kind === "EDARAN" ? C : F;
  return (
    <>
      <PdfText fixed style={{ ...s.footerText, fontFamily, left: 2 * CM, fontStyle: "italic", color: "#444" }}>{label ?? f.footerText ?? ""}</PdfText>
      <PdfText fixed style={{ ...s.footerText, fontFamily, right: 2 * CM }} render={({ pageNumber, totalPages }) => `Hal. ${pageNumber} dari ${totalPages}`} />
    </>
  );
}

/** Pisahkan blok terakhir untuk digabung dengan tanda tangan; bila blok terakhir daftar diktum, hanya itemnya yang terakhir (label otomatis dipertahankan lewat `autoStart`). */
function splitTail(content: PmNode[]): { head: PmNode[]; tail: PmNode[] } {
  const last = content[content.length - 1];
  if (last?.type === "diktumList" && (last.content?.length ?? 0) > 1) {
    const items = last.content!;
    const autoBefore = items.slice(0, -1).filter((it) => typeof it.attrs?.label !== "string").length + Number(last.attrs?.autoStart ?? 0);
    return {
      head: [...content.slice(0, -1), { ...last, content: items.slice(0, -1) }],
      tail: [{ ...last, attrs: { ...(last.attrs ?? {}), autoStart: autoBefore }, content: [items[items.length - 1]!] }],
    };
  }
  return { head: content.slice(0, -1), tail: content.slice(-1) };
}

/** `qrDataUrl`: gambar QR (PNG data URL) yang dibuat pemanggil dari `frame.verify.url`. */
export function DocumentPdf({ frame: f, qrDataUrl }: { frame: DocFrame; qrDataUrl: string | null }) {
  const body: PmDoc = f.body;
  const isSk = f.kind === "SK";
  const isEdaran = f.kind === "EDARAN";
  // SK dan Surat Edaran: judul, nomor, dan "TENTANG" disusun di kertas (isi), bukan blok Nomor/Perihal/Kepada.
  const bare = isSk || isEdaran;
  const lay = isEdaran ? EDARAN_LAYOUT : DEFAULT_LAYOUT;
  const { head, tail } = splitTail(body.content);
  return (
    <Document title={f.number ?? "Draf dokumen"} author="Trilogika Edutama">
      <Page size="A4" style={isEdaran ? [s.page, EDARAN_PAGE] : s.page}>
        {f.draft ? <PdfText style={s.watermark} fixed>DRAF</PdfText> : null}
                <Kop f={f} />
        {bare ? null : <Identity f={f} />}
        {bare ? null : <Recipient f={f} />}
        {f.salutation ? <Text style={{ fontStyle: "italic", fontWeight: "bold", marginBottom: 6 }}>{f.salutation}</Text> : null}
        <Blocks nodes={head} lay={lay} />
        {/* Paragraf terakhir + penutup + tanda tangan satu kesatuan: tanda tangan tidak pernah sendirian di halaman baru. */}
        <View wrap={false}>
          <Blocks nodes={tail} lay={lay} />
          {f.closing ? <Text style={{ fontStyle: "italic", fontWeight: "bold" }}>{f.closing}</Text> : null}
          {isSk ? <Text style={{ marginTop: 10 }}>Ditetapkan di : {f.place}{"\n"}Pada tanggal : {longDate(f.date)}</Text> : null}
          <SignBlock f={f} qr={qrDataUrl} />
        </View>
        <Cc items={f.cc} />
        <Footer f={f} />
      </Page>
      {f.attachments.map((a, k) => (
        <Page key={k} size="A4" style={s.page}>
          {f.draft ? <PdfText style={s.watermark} fixed>DRAF</PdfText> : null}
          <Text style={{ fontWeight: "bold", marginBottom: 2 }}>{`Lampiran${f.attachments.length > 1 ? ` ${k + 1}` : ""} — Surat Nomor ${f.number ?? "(draf)"}`}</Text>
          <Text style={{ textAlign: "center", fontWeight: "bold", fontSize: 13, marginBottom: 10 }}>{a.title}</Text>
          <Blocks nodes={a.body.content} lay={DEFAULT_LAYOUT} />
          {a.signatory ? <SignBlock f={f} qr={qrDataUrl} extra={[a.signatory]} /> : null}
          <Footer f={f} label={`Lampiran ${f.number ?? ""}`} />
        </Page>
      ))}
    </Document>
  );
}
