import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import path from "node:path";
import type { PmDoc, PmNode } from "@/lib/documents/content";
import type { DocFrame, DocImage, DocSignatory } from "@/lib/documents/frame";
import { diktumLabel, listMarker, longDate, type ListStyle } from "@/lib/documents/text";

/**
 * RENDERER PDF DOKUMEN (persuratan): membaca JSON isi + bingkai dan menghasilkan PDF A4.
 * Font Liberation Serif (metrik Times New Roman, lisensi OFL) di-embed dari public/fonts.
 */
const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const F = "LiberationSerif";
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
const FIRST_LINE = 1.25 * CM;
const src = (img: DocImage | null | undefined) => (img ? `data:${img.mimeType};base64,${img.data.toString("base64")}` : null);

const s = StyleSheet.create({
  page: { fontFamily: F, fontSize: BASE, lineHeight: LINE, paddingTop: 1.5 * CM, paddingBottom: 2.1 * CM, paddingHorizontal: 2 * CM, color: "#000" },
  kop: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  kopLogo: { width: 78, height: 78, marginRight: 14, objectFit: "contain" },
  kopText: { flex: 1 },
  kopName: { fontFamily: F, fontWeight: "bold", fontSize: 15, textDecoration: "underline", marginVertical: 1, lineHeight: 1.15 },
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
  footer: { position: "absolute", left: 2 * CM, right: 2 * CM, bottom: 1.2 * CM, fontSize: 8.5, flexDirection: "row", justifyContent: "space-between" },
  watermark: { position: "absolute", top: 300, left: 70, fontSize: 130, color: "#e6e6e6", transform: "rotate(-35deg)", fontWeight: "bold" },
});

type Inline = PmNode;
function runStyle(n: Inline) {
  const m = new Set((n.marks ?? []).map((x) => x.type));
  return { fontWeight: m.has("bold") ? ("bold" as const) : undefined, fontStyle: m.has("italic") ? ("italic" as const) : undefined, textDecoration: m.has("underline") ? ("underline" as const) : undefined };
}
function Runs({ nodes }: { nodes: Inline[] | undefined }) {
  return <>{(nodes ?? []).map((n, k) => (n.type === "hardBreak" ? <Text key={k}>{"\n"}</Text> : n.type === "text" ? <Text key={k} style={runStyle(n)}>{n.text}</Text> : null))}</>;
}

const mgn = (cm: unknown) => (typeof cm === "number" ? cm * CM : 0);

function Para({ n, extraIndent = 0 }: { n: PmNode; extraIndent?: number }) {
  const a = n.attrs ?? {};
  const isHeading = n.type === "heading";
  const align = (a.textAlign as "left" | "center" | "right" | "justify" | undefined) ?? "left";
  return (
    <Text
      style={{ textAlign: align, marginLeft: mgn(a.indent) + extraIndent, textIndent: a.firstLine ? FIRST_LINE : 0, marginBottom: typeof a.spaceAfter === "number" ? a.spaceAfter : 6, fontWeight: isHeading ? "bold" : undefined, fontSize: isHeading ? BASE + (4 - Number(a.level ?? 3)) : BASE }}
      minPresenceAhead={isHeading ? 40 : undefined}
    >
      <Runs nodes={n.content} />
    </Text>
  );
}

function Blocks({ nodes, indent = 0 }: { nodes: PmNode[] | undefined; indent?: number }) {
  return <>{(nodes ?? []).map((n, k) => <Block key={k} n={n} indent={indent} />)}</>;
}

function Block({ n, indent }: { n: PmNode; indent: number }) {
  switch (n.type) {
    case "paragraph":
    case "heading":
      return <Para n={n} extraIndent={indent} />;
    case "pageBreak":
      return <View break />;
    case "optionalBlock":
      return n.attrs?.enabled === false ? null : <Blocks nodes={n.content} indent={indent} />;
    case "bulletList":
    case "orderedList": {
      const style = (n.attrs?.style as ListStyle | undefined) ?? "decimal";
      const start = Number(n.attrs?.start ?? 1);
      const left = indent + (n.attrs?.indent !== undefined ? mgn(n.attrs.indent) : 0);
      return (
        <View style={{ marginLeft: left }}>
          {(n.content ?? []).map((item, k) => (
            <View key={k} style={{ flexDirection: "row", marginBottom: 2 }} wrap={false}>
              <Text style={{ width: 0.9 * CM }}>{n.type === "bulletList" ? "•" : listMarker(style, start + k)}</Text>
              <View style={{ flex: 1 }}><Blocks nodes={item.content} /></View>
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
              <Text style={{ width: lw }}>{String(r.attrs?.label ?? "")}</Text>
              <Text style={{ width: 10 }}>:</Text>
              <Text style={{ flex: 1 }}><Runs nodes={r.content} /></Text>
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
                <View style={{ flex: 1 }}><Blocks nodes={item.content} /></View>
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
                    <Blocks nodes={c.content} />
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

function Kop({ f }: { f: DocFrame }) {
  const l = f.letterhead;
  const logo = src(l.logo);
  return (
    <View>
      <View style={s.kop}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
        {logo ? <Image src={logo} style={s.kopLogo} /> : null}
        <View style={s.kopText}>
          <Text style={{ fontWeight: "bold", fontSize: 11, lineHeight: 1.15 }}>{l.tagline}</Text>
          <Text style={s.kopName}>{l.name}</Text>
          {l.addressLines.map((x, k) => <Text key={k} style={{ fontStyle: "italic", fontSize: 9.5, lineHeight: 1.15 }}>{x}</Text>)}
          <Text style={{ fontStyle: "italic", fontSize: 9.5, lineHeight: 1.15 }}>{l.contactLine}</Text>
          {l.idLine ? <Text style={{ fontStyle: "italic", fontSize: 9.5, lineHeight: 1.15 }}>{l.idLine}</Text> : null}
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
      <View style={{ flexDirection: "row" }}>
        {list.map((sg, k) => (
          <View key={k} style={s.signBox}>
            {sg.orgName ? <Text style={{ fontWeight: "bold" }}>{sg.orgName}</Text> : null}
            <Text style={{ fontWeight: "bold" }}>{sg.title}</Text>
            {f.draft ? <View style={{ height: 82 }} /> : <SignatureArt sg={sg} />}
            <Text style={{ fontWeight: "bold", textDecoration: "underline" }}>{sg.name}</Text>
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

function Footer({ f, label }: { f: DocFrame; label?: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={{ fontStyle: "italic", color: "#444" }}>{label ?? f.footerText ?? ""}</Text>
      <Text render={({ pageNumber, totalPages }) => `Hal. ${pageNumber} dari ${totalPages}`} />
    </View>
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
  const { head, tail } = splitTail(body.content);
  return (
    <Document title={f.number ?? "Draf dokumen"} author="Trilogika Edutama">
      <Page size="A4" style={s.page}>
        {f.draft ? <Text style={s.watermark} fixed>DRAF</Text> : null}
        <Kop f={f} />
        {isSk ? null : <Identity f={f} />}
        {isSk ? null : <Recipient f={f} />}
        {f.salutation ? <Text style={{ fontStyle: "italic", fontWeight: "bold", marginBottom: 6 }}>{f.salutation}</Text> : null}
        <Blocks nodes={head} />
        {/* Paragraf terakhir + penutup + tanda tangan satu kesatuan: tanda tangan tidak pernah sendirian di halaman baru. */}
        <View wrap={false}>
          <Blocks nodes={tail} />
          {f.closing ? <Text style={{ fontStyle: "italic", fontWeight: "bold" }}>{f.closing}</Text> : null}
          {isSk ? <Text style={{ marginTop: 10 }}>Ditetapkan di : {f.place}{"\n"}Pada tanggal : {longDate(f.date)}</Text> : null}
          <SignBlock f={f} qr={qrDataUrl} />
        </View>
        <Cc items={f.cc} />
        <Footer f={f} />
      </Page>
      {f.attachments.map((a, k) => (
        <Page key={k} size="A4" style={s.page}>
          {f.draft ? <Text style={s.watermark} fixed>DRAF</Text> : null}
          <Text style={{ fontWeight: "bold", marginBottom: 2 }}>{`Lampiran${f.attachments.length > 1 ? ` ${k + 1}` : ""} — Surat Nomor ${f.number ?? "(draf)"}`}</Text>
          <Text style={{ textAlign: "center", fontWeight: "bold", fontSize: 13, marginBottom: 10 }}>{a.title}</Text>
          <Blocks nodes={a.body.content} />
          {a.signatory ? <SignBlock f={f} qr={qrDataUrl} extra={[a.signatory]} /> : null}
          <Footer f={f} label={`Lampiran ${f.number ?? ""}`} />
        </Page>
      ))}
    </Document>
  );
}
