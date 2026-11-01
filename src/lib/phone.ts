/**
 * Normalisasi nomor WhatsApp ke format internasional tanpa "+" (mis. 628123456789).
 * Menerima "0812-3456-789", "+62 812 3456 789", "62812…", "812…". Mengembalikan null bila tidak masuk akal.
 * Nomor non-Indonesia diterima bila sudah berawalan kode negara (10–15 digit, tidak berawalan 0).
 */
export function normalizeWhatsappNumber(raw: string | null | undefined, defaultCountry = "62"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^[+\d][\d\s().\-]*$/.test(trimmed)) return null;
  let d = trimmed.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = defaultCountry + d.slice(1);
  else if (defaultCountry === "62" && d.startsWith("8")) d = "62" + d;
  if (d.length < 10 || d.length > 15) return null;
  if (d.startsWith("62")) {
    // Seluler Indonesia: 62 8xx xxxx xxxx (total 11–14 digit)
    const local = d.slice(2);
    if (!local.startsWith("8") || local.length < 8 || local.length > 12) return null;
  }
  return d;
}

/** "628123456789" → "+62 812-3456-789" (untuk tampilan). */
export function formatWhatsappNumber(n: string | null | undefined): string {
  if (!n) return "—";
  return n.startsWith("62") ? `+62 ${n.slice(2, 5)}-${n.slice(5, 9)}-${n.slice(9)}`.replace(/-$/, "") : `+${n}`;
}
