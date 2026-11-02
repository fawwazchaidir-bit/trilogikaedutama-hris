import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfSafe } from "./ReportPdf";
import { formatDateLong } from "@/lib/format";

export const RED = "#c8202b";
export const INK = "#151515";
export const MUTED = "#6b6760";
export const LINE = "#e4e1dc";

export interface SignerData { name: string; title: string | null; place: string | null; signatureFileId: string | null }
export interface PdfImage { data: Buffer; mimeType: string }

const toSrc = (img: PdfImage | null | undefined) => (img ? `data:${img.mimeType};base64,${img.data.toString("base64")}` : null);

const cache = new Map<string, ReturnType<typeof make>>();
function make(font: number, sig: number) {
  return StyleSheet.create({
    wrap: { marginTop: 8, alignItems: "flex-end" },
    box: { width: 190, alignItems: "center" },
    meta: { fontSize: font },
    img: { height: sig, width: 150, objectFit: "contain", marginTop: 2 },
    gap: { height: sig, marginTop: 2 },
    name: { fontFamily: "Helvetica-Bold", marginTop: 1, paddingTop: 2, borderTopWidth: 0.8, borderTopColor: INK, width: "100%", textAlign: "center" },
  });
}
const styles = (font: number, sig: number) => {
  const k = `${font}/${sig}`;
  if (!cache.has(k)) cache.set(k, make(font, sig));
  return cache.get(k)!;
};

/**
 * Satu kotak tanda tangan: baris keterangan di atas, gambar tanda tangan (atau ruang kosong untuk tanda tangan basah), lalu garis dan nama.
 * Dipakai oleh blok penanda tangan resmi (slip gaji, surat tugas, bukti penerimaan) DAN kotak "Penerima" pada bukti penerimaan,
 * sehingga ukuran, garis, dan huruf selalu seragam.
 */
export function SignBox({ lines, name, image, font, sig, align = "flex-end", children }: {
  lines: string[]; name: string; image?: PdfImage | null; font: number; sig: number; align?: "flex-start" | "flex-end"; children?: React.ReactNode;
}) {
  const s = styles(font, sig);
  const src = toSrc(image);
  return (
    <View style={[s.wrap, { alignItems: align }]} wrap={false}>
      <View style={s.box}>
        {lines.map((l, i) => <Text key={i} style={s.meta}>{pdfSafe(l)}</Text>)}
        {children}
        {/* eslint-disable-next-line jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
        {src ? <Image src={src} style={s.img} /> : <View style={s.gap} />}
        <Text style={s.name}>{pdfSafe(name)}</Text>
      </View>
    </View>
  );
}

/**
 * Blok penanda tangan resmi lembaga — SAMA untuk slip gaji, surat tugas, dan bukti penerimaan uang harian:
 * "Kota, tanggal" / jabatan / gambar tanda tangan / garis + nama (diatur Super Admin di Pengaturan, dibekukan pada snapshot dokumen).
 */
export function SignerBlock({ signer, date, signature, font, sig }: { signer: SignerData; date: string; signature?: PdfImage | null; font: number; sig: number }) {
  const lines = [[signer.place, formatDateLong(date)].filter(Boolean).join(", "), ...(signer.title ? [signer.title] : [])];
  return <SignBox lines={lines} name={signer.name} image={signature} font={font} sig={sig} />;
}

const head = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: RED },
  logo: { width: 48, height: 48, marginRight: 12, objectFit: "contain" },
  company: { fontFamily: "Helvetica-Bold", fontSize: 14 },
  tagline: { color: RED, fontSize: 8.5, marginTop: 4.5 },
  meta: { color: MUTED, fontSize: 8, marginTop: 4.5 },
});

/** Kop surat: logo, nama lembaga, tagline, alamat/kontak — sama dengan kop slip gaji. */
export function Letterhead({ company, logo }: { company: { name: string; tagline: string | null; address: string | null; phone: string | null; email: string | null }; logo: PdfImage | null }) {
  const src = toSrc(logo);
  return (
    <View style={head.head}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- <Image> milik react-pdf tidak punya atribut alt */}
      {src && <Image src={src} style={head.logo} />}
      <View style={{ flex: 1 }}>
        <Text style={head.company}>{pdfSafe(company.name)}</Text>
        {company.tagline && <Text style={head.tagline}>{pdfSafe(company.tagline)}</Text>}
        <Text style={head.meta}>{pdfSafe([company.address, company.phone, company.email].filter(Boolean).join("  |  "))}</Text>
      </View>
    </View>
  );
}
