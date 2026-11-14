"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import {
  DEFAULT_FOOTER, FOOTER_FONTS, FOOTER_FONT_KEYS, FOOTER_SIZE, FOOTER_TEXT_MAX, FOOTER_TOKENS, FOOTER_TOKEN_HELP, footerTextProblems, footerZones, isFooterFontKey, resolveFooterText,
  type DocFooter, type FooterZoneKey,
} from "@/lib/documents/footer";

const ZONES: { key: FooterZoneKey; label: string }[] = [{ key: "left", label: "Teks kiri" }, { key: "center", label: "Teks tengah" }, { key: "right", label: "Teks kanan" }];
const STYLE_DEFAULTS = { fontKey: DEFAULT_FOOTER.fontKey, bold: DEFAULT_FOOTER.bold, italic: DEFAULT_FOOTER.italic, underline: DEFAULT_FOOTER.underline, color: DEFAULT_FOOTER.color, rule: DEFAULT_FOOTER.rule } as const;
const today = () => new Date().toISOString().slice(0, 10);

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="font-medium text-ink">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}

/** Pengaturan kaki halaman (footer) semua PDF surat: tiga zona teks + token, font, ukuran, tebal/miring/garis bawah, warna, garis pemisah, halaman pertama & lampiran. */
export function FooterSettings({ footer }: { footer: DocFooter }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<DocFooter>(footer);
  const [size, setSize] = useState(String(footer.size));
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const last = useRef<FooterZoneKey>("right");
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const set = <K extends keyof DocFooter>(k: K, v: DocFooter[K]) => setF((x) => ({ ...x, [k]: v }));
  const sizeNum = Number(size);
  const sizeOk = size.trim() !== "" && Number.isFinite(sizeNum) && sizeNum >= FOOTER_SIZE.min && sizeNum <= FOOTER_SIZE.max && Number.isInteger(sizeNum * 2);
  const problems = ZONES.flatMap((z) => footerTextProblems(f[z.key]).map((m) => `${z.label}: ${m}`));
  const canSend = sizeOk && problems.length === 0;
  const payload = () => ({ footer: { ...f, size: sizeNum, left: f.left?.trim() || null, center: f.center?.trim() || null, right: f.right?.trim() || null } });

  const insert = (token: string) => {
    const k = last.current;
    setF((x) => ({ ...x, [k]: `${x[k] ?? ""}{${token}}` }));
  };

  async function save() {
    setBusy("save");
    try { await api("/api/letters/settings", { method: "PATCH", body: payload() }); toast.success("Kaki halaman disimpan."); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
  async function preview() {
    setBusy("preview");
    try {
      const res = await fetch("/api/letters/settings/footer-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()), credentials: "same-origin" });
      if (!res.ok) {
        let msg = "Pratinjau gagal dibuat.";
        try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* bukan JSON */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(await res.blob());
      setPdfUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }

  const sample = { page: 1, total: 3, number: "001/TE-EKS/003/XI/2026", date: today() };
  const zones = footerZones(f);
  const shownSize = sizeOk ? sizeNum : f.size;
  const font = isFooterFontKey(f.fontKey) ? FOOTER_FONTS[f.fontKey] : FOOTER_FONTS.LIBERATION_SERIF;

  return (
    <Card>
      <CardHeader title="Kaki halaman (footer)" description="Berlaku untuk semua halaman PDF yang dibuat sistem: halaman surat, SK, dan halaman lampiran dari editor. Lampiran PDF unggahan yang digabung tidak diubah." />
      <div className="space-y-4 p-4">
        <Check label="Tampilkan kaki halaman" checked={f.enabled} onChange={(v) => set("enabled", v)} />

        <fieldset className="space-y-3 rounded-lg border border-line p-3" disabled={!f.enabled}>
          <legend className="px-1 text-xs font-semibold text-ink-soft">Isi (tiga zona)</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {ZONES.map((z) => (
              <TextField key={z.key} label={z.label} value={f[z.key] ?? ""} maxLength={FOOTER_TEXT_MAX} onFocus={() => { last.current = z.key; }}
                onChange={(e) => set(z.key, e.target.value)} error={footerTextProblems(f[z.key])[0]} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>Sisipkan ke kolom yang terakhir diklik:</span>
            {FOOTER_TOKENS.map((t) => (
              <button key={t} type="button" onClick={() => insert(t)} title={FOOTER_TOKEN_HELP[t]} aria-label={`Sisipkan token ${t}`}
                className="rounded-md border border-line bg-white px-2 py-0.5 font-mono text-xs text-ink hover:bg-canvas">{`{${t}}`}</button>
            ))}
          </div>
          <p className="text-xs text-muted">Contoh: <code>Hal. {"{halaman}"} dari {"{total}"}</code>. Kosongkan zona yang tidak dipakai.</p>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-line p-3" disabled={!f.enabled}>
          <legend className="px-1 text-xs font-semibold text-ink-soft">Gaya teks</legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto]">
            <SelectField label="Font" value={f.fontKey} onChange={(e) => set("fontKey", e.target.value as DocFooter["fontKey"])} hint="Padanan metrik-kompatibel (tertanam di PDF).">
              {FOOTER_FONT_KEYS.map((k) => <option key={k} value={k}>{FOOTER_FONTS[k].label}</option>)}
            </SelectField>
            <TextField label="Ukuran (pt)" type="number" min={FOOTER_SIZE.min} max={FOOTER_SIZE.max} step={0.5} value={size} onChange={(e) => setSize(e.target.value)}
              error={!sizeOk ? `${FOOTER_SIZE.min}–${FOOTER_SIZE.max}, kelipatan 0,5` : undefined} />
            <label className="block text-sm"><span className="mb-1 block font-medium text-ink">Warna</span>
              <span className="flex h-10 items-center gap-2"><input type="color" aria-label="Warna teks kaki halaman" value={f.color} onChange={(e) => set("color", e.target.value)} className="h-10 w-12 cursor-pointer rounded-md border border-line bg-white p-1" />
                <span className="font-mono text-xs text-muted">{f.color}</span></span></label>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Check label="Tebal" checked={f.bold} onChange={(v) => set("bold", v)} />
            <Check label="Miring" checked={f.italic} onChange={(v) => set("italic", v)} />
            <Check label="Garis bawah" checked={f.underline} onChange={(v) => set("underline", v)} />
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-line p-3" disabled={!f.enabled}>
          <legend className="px-1 text-xs font-semibold text-ink-soft">Tampil di</legend>
          <Check label="Garis pemisah di atas kaki halaman" checked={f.rule} onChange={(v) => set("rule", v)} />
          <Check label="Tampilkan di halaman pertama" checked={f.firstPage} onChange={(v) => set("firstPage", v)} />
          <Check label="Tampilkan di halaman lampiran" checked={f.attachments} onChange={(v) => set("attachments", v)} hint="Halaman lampiran yang disusun di editor. Penomoran halaman berlanjut dari surat." />
        </fieldset>

        <div>
          <p className="mb-1 text-xs font-semibold text-ink-soft">Pratinjau cepat (perkiraan; contoh halaman 1 dari 3)</p>
          <div role="img" aria-label="Pratinjau kaki halaman" className="rounded-md border border-line bg-white px-5 py-4">
            {f.enabled && zones.length > 0 ? (
              <div data-testid="footer-live-preview" style={{
                display: "flex", gap: 8, fontFamily: font.css, fontSize: `${shownSize}pt`, fontWeight: f.bold ? 700 : 400, fontStyle: f.italic ? "italic" : "normal",
                textDecoration: f.underline ? "underline" : "none", color: f.color, ...(f.rule ? { borderTop: `0.5pt solid ${f.color}`, paddingTop: 3 } : {}),
              }}>
                {zones.map((z) => <span key={z.key} style={{ flex: z.flex, textAlign: z.align }}>{resolveFooterText(z.text, sample)}</span>)}
              </div>
            ) : <p className="text-xs text-muted">{f.enabled ? "Semua zona kosong — tidak ada yang dicetak." : "Kaki halaman dimatikan."}</p>}
          </div>
        </div>

        {problems.length > 0 && <p role="alert" className="text-xs font-medium text-brand-700">{problems.join(" · ")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy === "save"} disabled={!canSend} onClick={() => void save()}>Simpan kaki halaman</Button>
          <Button loading={busy === "preview"} disabled={!canSend} onClick={() => void preview()}>Pratinjau PDF</Button>
          <Button onClick={() => { setF((x) => ({ ...x, ...STYLE_DEFAULTS })); setSize(String(DEFAULT_FOOTER.size)); }}>Kembalikan gaya bawaan</Button>
        </div>
        {pdfUrl && <iframe title="Pratinjau PDF kaki halaman" src={pdfUrl} className="h-[34rem] w-full max-w-2xl rounded-md border border-line bg-white" />}
      </div>
    </Card>
  );
}
