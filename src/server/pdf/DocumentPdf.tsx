import { Document, Font, Image, Page, StyleSheet, Text as PdfText, View, type TextProps } from "@react-pdf/renderer";
import type { PropsWithChildren } from "react";
import path from "node:path";
import type { PmDoc, PmNode } from "@/lib/documents/content";
import type { DocFrame, DocImage, DocSignatory } from "@/lib/documents/frame";
import { diktumLabel, listMarker, longDate, type ListStyle } from "@/lib/documents/text";
import { FOOTER_FONTS, footerReserve, footerZones, resolveFooterText } from "@/lib/documents/footer";
import { CONTENT_W, MEASURE_DEFAULT, MEASURE_EDARAN, estimateBlocks, estimateTableRows, keepsTogether, type MeasureLayout } from "@/lib/documents/layout-estimate";
import { cellPercent, columnPercents, layoutTable } from "@/lib/documents/table-grid";

/**
 * RENDERER PDF DOKUMEN (persuratan): membaca JSON isi + bingkai dan menghasilkan PDF A4.
 * Isi surat: Liberation Serif (metrik Times New Roman). Kop surat dan layout EDARAN: Caladea (metrik Cambria). Keduanya lisensi OFL, di-embed dari public/fonts.
 * Cambria adalah font berlisensi Microsoft sehingga tidak dibundel; Caladea dirancang metrik-kompatibel dengannya (lebar glif sama → tata letak identik di Word).
 */
const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const F = "LiberationSerif";
const C = "Caladea"; // pengganti Cambria (metrik sama)
/** Empat keluarga tertanam (juga pilihan font kaki halaman, lihat lib/documents/footer.ts): Times New Roman, Arial, Cambria, Calibri → padanan metrik-kompatibel (SIL OFL). */
for (const family of ["LiberationSerif", "LiberationSans", "Caladea", "Carlito"]) {
  Font.register({
    family,
    fonts: [
      { src: path.join(FONT_DIR, `${family}-Regular.ttf`) },
      { src: path.join(FONT_DIR, `${family}-Bold.ttf`), fontWeight: "bold" },
      { src: path.join(FONT_DIR, `${family}-Italic.ttf`), fontStyle: "italic" },
      { src: path.join(FONT_DIR, `${family}-BoldItalic.ttf`), fontWeight: "bold", fontStyle: "italic" },
    ],
  });
}
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
interface Layout { lh: string; listGap: number; /** Ukuran untuk memperkirakan tinggi blok (layout-estimate.ts). */ est: MeasureLayout }
const DEFAULT_LAYOUT: Layout = { lh: lineCtx(BASE, LINE), listGap: 0, est: MEASURE_DEFAULT };
const EDARAN_LAYOUT: Layout = { lh: lineCtx(12, 1.5), listGap: 12, est: MEASURE_EDARAN };
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
  /** Pengganti garis saat ditiadakan: tinggi dan jarak sama persis supaya isi surat tidak bergeser. */
  ruleSpace: { height: 1.2, marginBottom: 10 },
  idRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  idK: { width: 62, fontWeight: "bold" },
  idV: { fontWeight: "bold" },
  signWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 10 },
  qrBox: { width: 150, alignItems: "flex-start" },
  qr: { width: 74, height: 74 },
  qrCap: { fontSize: 7.5, lineHeight: 1.25, marginTop: 3, width: 140 },
  signBox: { width: 200, alignItems: "center" },
  /** Grid tanda tangan untuk 2 pihak atau lebih: dua kolom sama lebar (cukup untuk kotak 200 pt), baris tidak pernah terpotong. */
  signGrid: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 10 },
  signCell: { width: 240, alignItems: "center" },
  signCellQr: { width: 240, alignItems: "flex-start" },
  signArt: { width: 200, height: 82, position: "relative" },
  footerBox: { position: "absolute", left: 2 * CM, right: 2 * CM, bottom: 1.2 * CM },
  watermark: { position: "absolute", top: 300, left: 70, fontSize: 130, lineHeight: 1.3, color: "#e6e6e6", transform: "rotate(-35deg)", fontWeight: "bold" },
});

type Inline = PmNode;
function runStyle(n: Inline) {
  const m = new Set((n.marks ?? []).map((x) => x.type));
  return { fontWeight: m.has("bold") ? ("bold" as const) : undefined, fontStyle: m.has("italic") ? ("italic" as const) : undefined, textDecoration: m.has("underline") ? ("underline" as const) : undefined };
}
/**
 * `indent` = lekukan baris pertama (pt). react-pdf membaca lekukan dari atribut RUN PERTAMA paragraf (textkit: `paragraph.runs[0].attributes.indent`), dan `textIndent` tidak diwariskan ke
 * anak <Text>; karena itu lekukan dipasang pada elemen anak pertama, BUKAN pada <Text> induk (yang hanya membungkus run).
 */
function Runs({ nodes, indent = 0 }: { nodes: Inline[] | undefined; indent?: number }) {
  const first = (k: number) => (k === 0 && indent ? { textIndent: indent } : {});
  return <>{(nodes ?? []).map((n, k) => (n.type === "hardBreak" ? <PdfText key={k} style={first(k)}>{"\n"}</PdfText> : n.type === "text" ? <PdfText key={k} style={{ ...runStyle(n), ...first(k) }}>{n.text}</PdfText> : null))}</>;
}

const mgn = (cm: unknown) => (typeof cm === "number" ? cm * CM : 0);

function Para({ n, extraIndent = 0, lay }: { n: PmNode; extraIndent?: number; lay: Layout }) {
  const a = n.attrs ?? {};
  const isHeading = n.type === "heading";
  const align = (a.textAlign as "left" | "center" | "right" | "justify" | undefined) ?? "left";
  return (
    <Text
      lh={lay.lh}
      style={{ textAlign: align, marginLeft: mgn(a.indent) + extraIndent, marginBottom: typeof a.spaceAfter === "number" ? a.spaceAfter : 6, fontWeight: isHeading ? "bold" : undefined, fontSize: isHeading ? BASE + (4 - Number(a.level ?? 3)) : undefined }}
      minPresenceAhead={isHeading ? 40 : undefined}
    >
      <Runs nodes={n.content} indent={a.firstLine ? FIRST_LINE : 0} />
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
            // Butir PENDEK dijaga utuh; butir yang diperkirakan sangat panjang dibiarkan terpecah antar halaman (elemen wrap={false} yang lebih tinggi dari halaman meluber dan menimpa isi lain).
            <View key={k} style={{ flexDirection: "row", marginBottom: 2 }} wrap={!keepsTogether(estimateBlocks(item.content, CONTENT_W - left - 0.9 * CM, lay.est))}>
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
            <View key={k} style={{ flexDirection: "row", marginBottom: 1 }} wrap={!keepsTogether(estimateBlocks([{ type: "paragraph", content: r.content }], CONTENT_W - lw - 10, lay.est))}>
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
    case "table":
      return <TableBlock n={n} indent={indent} lay={lay} />;
    default:
      return null;
  }
}

/**
 * Tabel: lebar sel dihitung dari indeks KOLOM (colspan dan rowspan diperhitungkan, lihat table-grid.ts) sehingga setiap baris sampai tepi kanan. Sel rowspan digambar di baris
 * pertamanya; baris berikutnya memuat penampung kosong di kolom itu (garis bawah hanya di baris terakhir yang ditempati). Baris pendek dijaga utuh; baris yang diperkirakan sangat
 * panjang boleh terpecah antar halaman.
 */
function TableBlock({ n, indent, lay }: { n: PmNode; indent: number; lay: Layout }) {
  const grid = layoutTable(n.content ?? []);
  const pct = columnPercents(grid.cols, n.attrs?.colWidths as number[] | undefined);
  const heights = estimateTableRows(n, CONTENT_W - indent, lay.est);
  return (
    <View style={{ marginLeft: indent, marginBottom: 8, borderTopWidth: 0.6, borderLeftWidth: 0.6 }}>
      {grid.rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row" }} wrap={!keepsTogether(heights[ri] ?? 0)}>
          {row.map((c, ci) => (
            <View key={ci} style={{ width: `${cellPercent(pct, c.col, c.colspan)}%`, borderRightWidth: 0.6, borderBottomWidth: c.endsHere ? 0.6 : 0, padding: 3, backgroundColor: c.header ? "#efefef" : undefined }}>
              {c.node ? <Blocks nodes={c.node.content} lay={lay} /> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Kop surat (format baru): logo di kiri; tagline (Cambria bold 12), nama lembaga (Cambria bold 14), alamat (Cambria italic 10), lalu baris kontak
 * Email/Telp/Website (Cambria italic 10) di bawah alamat. Garis di bawah kop dapat diadakan atau ditiadakan (`letterhead.rule`).
 */
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
          {l.contactLine ? <Text style={s.kopAddress}>{l.contactLine}</Text> : null}
        </View>
      </View>
      <View style={l.rule ? s.rule : s.ruleSpace} />
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

/**
 * Alamat tujuan format ringkas: "Yth. {baris pertama}" pada satu baris (awalan tidak tebal), baris berikutnya, lalu "di {tempat}" pada satu baris (mis. "di tempat").
 * Tempat bawaan ("Tempat") ditulis huruf kecil di tengah kalimat; nama kota yang diketik pengguna dipertahankan apa adanya.
 */
function Recipient({ f }: { f: DocFrame }) {
  const r = f.recipient;
  if (!r) return null;
  const [first, ...rest] = r.lines;
  const place = r.place ? (r.place.trim().toLowerCase() === "tempat" ? "tempat" : r.place.trim()) : null;
  const where = [r.cityPrefix?.trim() ? r.cityPrefix.trim().toLowerCase() : null, place].filter(Boolean).join(" ");
  return (
    <View style={{ marginBottom: 12 }} wrap={false}>
      {first ? <Text>{r.prefix ? `${r.prefix} ` : ""}<PdfText style={{ fontWeight: first.bold ? "bold" : undefined }}>{first.text}</PdfText></Text> : r.prefix ? <Text>{r.prefix}</Text> : null}
      {rest.map((l, k) => <Text key={k} style={{ fontWeight: l.bold ? "bold" : undefined }}>{l.text}</Text>)}
      {where ? <Text>{where}</Text> : null}
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

function SignerBox({ sg, f }: { sg: DocSignatory; f: DocFrame }) {
  return (
    <View style={s.signBox}>
      {sg.orgName ? <Text style={{ fontWeight: "bold" }}>{sg.orgName}</Text> : null}
      <Text style={{ fontWeight: "bold" }}>{sg.title}</Text>
      {f.draft || sg.external ? <View style={{ height: 82 }} /> : <SignatureArt sg={sg} />}
      <Text style={{ fontWeight: "bold", textDecoration: "underline" }}>{sg.name || "(.............................)"}</Text>
    </View>
  );
}
function QrBox({ f, qr }: { f: DocFrame; qr: string | null }) {
  return (
    <View style={s.qrBox}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
      {qr ? <Image src={qr} style={s.qr} /> : null}
      {f.verify && qr ? <Text style={s.qrCap}>{f.verify.caption}{f.number ? `\n${f.number}` : ""}</Text> : null}
    </View>
  );
}
/** Perkiraan tinggi (pt) satu baris tanda tangan dan baris QR — dipakai menentukan apa yang dijaga satu halaman dengan penutup surat. */
const SIGN_ROW_H = 150, QR_ROW_H = 115;

/**
 * Baris-baris tanda tangan. SATU pihak: QR di kiri, penandatangan di kanan (tata letak lama). DUA pihak atau lebih: grid dua kolom; tiap baris tidak pernah terpotong tetapi baris
 * berikutnya boleh pindah ke halaman berikutnya — tidak ada nama/tanda tangan yang keluar kertas. QR mengisi sel kosong di baris terakhir (jumlah ganjil) atau baris sendiri di
 * bawah (jumlah genap; dijaga bersama baris tanda tangan terakhir agar QR tidak sendirian di halaman baru).
 */
export function signRows(f: DocFrame, qr: string | null, list: DocSignatory[]): { rows: React.ReactNode[]; firstHeight: number } {
  const qrCell = <QrBox f={f} qr={qr} />;
  if (list.length <= 1) {
    return { rows: [<View key="r0" wrap={false} style={s.signWrap}>{qrCell}{list[0] ? <SignerBox sg={list[0]} f={f} /> : null}</View>], firstHeight: SIGN_ROW_H };
  }
  const rows: React.ReactNode[] = [];
  const pairs: DocSignatory[][] = [];
  for (let i = 0; i < list.length; i += 2) pairs.push(list.slice(i, i + 2));
  pairs.forEach((pair, i) => {
    const lastRow = i === pairs.length - 1;
    const line = pair.length === 2
      ? <View key={`p${i}`} wrap={false} style={s.signGrid}><View style={s.signCell}><SignerBox sg={pair[0]!} f={f} /></View><View style={s.signCell}><SignerBox sg={pair[1]!} f={f} /></View></View>
      : <View key={`p${i}`} wrap={false} style={s.signGrid}><View style={s.signCellQr}>{qrCell}</View><View style={s.signCell}><SignerBox sg={pair[0]!} f={f} /></View></View>;
    if (lastRow && pair.length === 2 && qr) {
      rows.push(<View key="last" wrap={false}>{line}<View style={s.signGrid}><View style={s.signCellQr}>{qrCell}</View></View></View>);
    } else rows.push(line);
  });
  const firstIsLastWithQr = pairs.length === 1 && pairs[0]!.length === 2 && !!qr;
  return { rows, firstHeight: SIGN_ROW_H + (firstIsLastWithQr ? QR_ROW_H : 0) };
}

/** Blok tanda tangan untuk halaman lampiran (satu penandatangan lampiran + QR). */
function SignBlock({ f, qr, extra }: { f: DocFrame; qr: string | null; extra?: DocSignatory[] }) {
  return <View>{signRows(f, qr, extra ?? f.signatories).rows}</View>;
}

function Cc({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: 12 }} wrap={!keepsTogether(items.reduce((h, c) => h + estimateBlocks([{ type: "paragraph", content: [{ type: "text", text: c }] }], CONTENT_W - 0.9 * CM, MEASURE_DEFAULT), 20))}>
      <Text style={{ fontWeight: "bold" }}>Tembusan:</Text>
      {items.map((c, k) => <View key={k} style={{ flexDirection: "row" }}><Text style={{ width: 0.9 * CM }}>{k + 1}.</Text><Text style={{ flex: 1 }}>{c}</Text></View>)}
    </View>
  );
}

/**
 * Kaki halaman (dapat diatur: lib/documents/footer.ts): tiga zona teks + token, font/ukuran/tebal/miring/garis bawah/warna, garis pemisah, halaman pertama, halaman lampiran.
 * View `fixed` ber-`render` (bukan teks `render` terpisah) agar halaman pertama dapat dikosongkan sekaligus garisnya. PdfText + keluarga font eksplisit: elemen `fixed` tidak mewarisi
 * font halaman (Helvetica bawaan). `lineHeight` Page tidak boleh dipasang (lihat catatan di atas) — jika tidak, teks kaki tercetak di luar kertas.
 */
function Footer({ f, attachment = false }: { f: DocFrame; attachment?: boolean }) {
  const ft = f.footer;
  if (!ft.enabled || (attachment && !ft.attachments)) return null;
  const zones = footerZones(ft);
  if (zones.length === 0) return null;
  const text = {
    fontFamily: FOOTER_FONTS[ft.fontKey].family, fontSize: ft.size, fontWeight: ft.bold ? ("bold" as const) : ("normal" as const), fontStyle: ft.italic ? ("italic" as const) : ("normal" as const),
    textDecoration: ft.underline ? ("underline" as const) : ("none" as const), color: ft.color,
  };
  return (
    <View
      fixed
      style={s.footerBox}
      render={(args) => {
        // Tipe `render` pada View di react-pdf belum memuat `totalPages`, padahal diberikan saat render (diuji).
        const { pageNumber, totalPages } = args as typeof args & { totalPages: number };
        if (pageNumber === 1 && !ft.firstPage) return null;
        // {total} = seluruh halaman berkas akhir: halaman yang dibuat di sini + halaman lampiran PDF yang digabung sesudahnya.
        const ctx = { page: pageNumber, total: totalPages + Math.max(0, f.extraPages ?? 0), number: f.number, date: f.date };
        return (
          <View style={{ flexDirection: "row", ...(ft.rule ? { borderTopWidth: 0.5, borderTopColor: ft.color, paddingTop: 3 } : {}) }}>
            {zones.map((z) => <PdfText key={z.key} style={{ ...text, flex: z.flex, textAlign: z.align }}>{resolveFooterText(z.text, ctx)}</PdfText>)}
          </View>
        );
      }}
    />
  );
}

/**
 * Pisahkan "satuan terakhir" isi untuk dijaga bersama penutup + tanda tangan: butir terakhir daftar diktum / berbutir, atau blok terakhir lain (paragraf, tabel). Label otomatis
 * diktum dan nomor daftar dipertahankan lewat `autoStart` / `start`.
 */
export function splitTail(content: PmNode[]): { head: PmNode[]; tail: PmNode[] } {
  const last = content[content.length - 1];
  if (last?.type === "diktumList" && (last.content?.length ?? 0) > 1) {
    const items = last.content!;
    const autoBefore = items.slice(0, -1).filter((it) => typeof it.attrs?.label !== "string").length + Number(last.attrs?.autoStart ?? 0);
    return {
      head: [...content.slice(0, -1), { ...last, content: items.slice(0, -1) }],
      tail: [{ ...last, attrs: { ...(last.attrs ?? {}), autoStart: autoBefore }, content: [items[items.length - 1]!] }],
    };
  }
  if ((last?.type === "orderedList" || last?.type === "bulletList") && (last.content?.length ?? 0) > 1) {
    const items = last.content!;
    return {
      head: [...content.slice(0, -1), { ...last, content: items.slice(0, -1) }],
      tail: [{ ...last, attrs: { ...(last.attrs ?? {}), start: Number(last.attrs?.start ?? 1) + items.length - 1 }, content: [items[items.length - 1]!] }],
    };
  }
  return { head: content.slice(0, -1), tail: content.slice(-1) };
}

/**
 * Ekor surat: satuan terakhir isi + penutup + (Ditetapkan di … untuk SK) + baris tanda tangan PERTAMA. Bila seluruhnya diperkirakan pendek, dijaga satu halaman agar tanda tangan
 * tidak sendirian di halaman baru. Bila terlalu panjang (mis. satu paragraf ±5.000 karakter), TIDAK dipaksa satu blok — elemen wrap={false} yang lebih tinggi dari halaman meluber dan
 * menimpa QR/tanda tangan — isi dibiarkan mengalir ke halaman berikutnya. Baris tanda tangan berikutnya (grid) mengalir terpisah.
 */
function Tail({ f, qr, lay, tail, isSk }: { f: DocFrame; qr: string | null; lay: Layout; tail: PmNode[]; isSk: boolean }) {
  const { rows, firstHeight } = signRows(f, qr, f.signatories);
  const closing = (
    <>
      {f.closing ? <Text style={{ fontStyle: "italic", fontWeight: "bold" }}>{f.closing}</Text> : null}
      {isSk ? <Text style={{ marginTop: 10 }}>Ditetapkan di : {f.place}{"\n"}Pada tanggal : {longDate(f.date)}</Text> : null}
      {rows[0]}
    </>
  );
  const est = estimateBlocks(tail, CONTENT_W, lay.est) + (f.closing ? 20 : 0) + (isSk ? 34 : 0) + firstHeight;
  return (
    <>
      {keepsTogether(est)
        ? <View wrap={false}><Blocks nodes={tail} lay={lay} />{closing}</View>
        : <><Blocks nodes={tail} lay={lay} /><View wrap={false}>{closing}</View></>}
      {rows.slice(1)}
    </>
  );
}

/** `qrDataUrl`: gambar QR (PNG data URL) yang dibuat pemanggil dari `frame.verify.url`. */
export function DocumentPdf({ frame: f, qrDataUrl }: { frame: DocFrame; qrDataUrl: string | null }) {
  const body: PmDoc = f.body;
  const isSk = f.kind === "SK";
  const isEdaran = f.kind === "EDARAN";
  // SK dan Surat Edaran: judul, nomor, dan "TENTANG" disusun di kertas (isi), bukan blok Nomor/Perihal/Kepada.
  const bare = isSk || isEdaran;
  const lay = isEdaran ? EDARAN_LAYOUT : DEFAULT_LAYOUT;
  /** Ruang bawah halaman: minimal 2,1 cm; bertambah bila kaki halaman besar/berbaris banyak. */
  const pb = Math.max(2.1 * CM, footerReserve(f.footer));
  const { head, tail } = splitTail(body.content);
  return (
    <Document title={f.number ?? "Draf dokumen"} author="Trilogika Edutama">
      <Page size="A4" style={[s.page, ...(isEdaran ? [EDARAN_PAGE] : []), { paddingBottom: pb }]}>
        {f.draft ? <PdfText style={s.watermark} fixed>DRAF</PdfText> : null}
                <Kop f={f} />
        {bare ? null : <Identity f={f} />}
        {bare ? null : <Recipient f={f} />}
        {f.salutation ? <Text style={{ fontStyle: "italic", fontWeight: "bold", marginBottom: 6 }}>{f.salutation}</Text> : null}
        <Blocks nodes={head} lay={lay} />
        <Tail f={f} qr={qrDataUrl} lay={lay} tail={tail} isSk={isSk} />
        <Cc items={f.cc} />
        <Footer f={f} />
      </Page>
      {f.attachments.map((a, k) => (
        <Page key={k} size="A4" style={[s.page, { paddingBottom: pb }]}>
          {f.draft ? <PdfText style={s.watermark} fixed>DRAF</PdfText> : null}
          <Text style={{ fontWeight: "bold", marginBottom: 2 }}>{`Lampiran${f.attachments.length > 1 ? ` ${k + 1}` : ""} — Surat Nomor ${f.number ?? "(draf)"}`}</Text>
          <Text style={{ textAlign: "center", fontWeight: "bold", fontSize: 13, marginBottom: 10 }}>{a.title}</Text>
          <Blocks nodes={a.body.content} lay={DEFAULT_LAYOUT} />
          {a.signatory ? <SignBlock f={f} qr={qrDataUrl} extra={[a.signatory]} /> : null}
          <Footer f={f} attachment />
        </Page>
      ))}
    </Document>
  );
}
