/**
 * Pencocokan alamat IP dengan daftar jaringan (IPv4/IPv6, tunggal atau CIDR). Murni (tanpa I/O) agar dapat diuji.
 * Dipakai untuk "jaringan kantor" pada absensi lokasi: sinyal yang TIDAK dapat dipalsukan oleh aplikasi lokasi palsu
 * (selama IP berasal dari proxy tepercaya — lihat TRUST_PROXY).
 */

interface Net { bits: 32 | 128; value: bigint; prefix: number }

function parseV4(s: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let v = 0n;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (n > 255 || (m[i]!.length > 1 && m[i]!.startsWith("0"))) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseV6(raw: string): bigint | null {
  let s = raw.toLowerCase();
  // Bentuk campuran ::ffff:1.2.3.4 → ubah bagian IPv4 menjadi dua grup heksadesimal.
  const mixed = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mixed) {
    const v4 = parseV4(mixed[2]!);
    if (v4 === null) return null;
    s = `${mixed[1]}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(s) || (s.match(/::/g)?.length ?? 0) > 1) return null;
  const [head = "", tail = ""] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const hasGap = s.includes("::");
  if (!hasGap && h.length !== 8) return null;
  if (hasGap && h.length + t.length > 7) return null;
  const groups = hasGap ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(`0x${g}`);
  }
  return v;
}

/** IPv4-mapped IPv6 (::ffff:a.b.c.d) → diperlakukan sebagai IPv4 agar cocok dengan daftar IPv4. */
function parseAddress(raw: string): { bits: 32 | 128; value: bigint; mapped: boolean } | null {
  const s = raw.trim();
  const v4 = parseV4(s);
  if (v4 !== null) return { bits: 32, value: v4, mapped: false };
  const v6 = parseV6(s.replace(/^\[|\]$/g, ""));
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) return { bits: 32, value: v6 & 0xffffffffn, mapped: true };
  return { bits: 128, value: v6, mapped: false };
}

/** "203.0.113.0/24", "203.0.113.7", "2001:db8::/32" → jaringan; null bila tidak valid. */
export function parseNetwork(text: string): Net | null {
  const [addr, pfx, extra] = text.trim().split("/");
  if (extra !== undefined || !addr) return null;
  const a = parseAddress(addr);
  if (!a) return null;
  let prefix: number = a.bits;
  if (pfx !== undefined) {
    if (!/^\d{1,3}$/.test(pfx)) return null;
    prefix = Number(pfx);
    // Awalan pada bentuk IPv4-mapped dihitung terhadap 128 bit: ::ffff:a.b.c.d/120 setara a.b.c.d/24.
    if (a.mapped) prefix -= 96;
    if (prefix < 0 || prefix > a.bits) return null;
  }
  const shift = BigInt(a.bits - prefix);
  return { bits: a.bits, value: (a.value >> shift) << shift, prefix };
}

export function isValidNetwork(text: string): boolean {
  return parseNetwork(text) !== null;
}

/** Apakah `ip` termasuk salah satu jaringan? Null/alamat tak valid → false. */
export function ipInNetworks(ip: string | null | undefined, networks: string[]): boolean {
  if (!ip) return false;
  const a = parseAddress(ip);
  if (!a) return false;
  for (const n of networks) {
    const net = parseNetwork(n);
    if (!net || net.bits !== a.bits) continue;
    const shift = BigInt(net.bits - net.prefix);
    if ((a.value >> shift) << shift === net.value) return true;
  }
  return false;
}
