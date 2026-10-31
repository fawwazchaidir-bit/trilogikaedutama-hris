import { describe, expect, it } from "vitest";
import { assessRisk, blockedMessage, BLOCK_AT, decide, FLAG_AT, type RiskFacts } from "@/lib/location-risk";
import { clientIpFromForwardedFor, ipInNetworks, isValidNetwork, parseNetwork } from "@/lib/ip";

const NOW = 1_760_000_000_000;
/** Pembacaan GPS yang tampak sah: presisi tinggi, baru, jam perangkat sinkron. */
const clean = (over: Partial<RiskFacts> = {}): RiskFacts => ({
  reading: { lat: -7.795612345, lng: 110.369587654, accuracy: 8.4, timestamp: NOW - 1500, clientNow: NOW + 200 },
  serverNowMs: NOW, distanceToCenter: 35, prev: null, sharedCoordsWithOther: false, sharedDeviceWithOther: false, deviceKnown: null, network: "NOT_CONFIGURED", ...over,
});

describe("assessRisk — pembacaan GPS sah tidak ditandai", () => {
  it("pembacaan normal: skor 0, tanpa flag", () => {
    const r = assessRisk(clean());
    expect(r.score).toBe(0);
    expect(r.flags).toEqual([]);
  });
  it("posisi jaringan/Wi-Fi (akurasi 40 m) yang identik dengan kemarin TIDAK dicurigai (itu perilaku normal)", () => {
    const r = assessRisk(clean({ reading: { ...clean().reading, accuracy: 40 }, prev: { lat: -7.795612345, lng: 110.369587654, accuracy: 40, atMs: NOW - 86_000_000 } }));
    expect(r.flags).not.toContain("REPEAT_COORDS");
  });
  it("karyawan yang berpindah wajar (5 km dalam 2 jam) tidak ditandai", () => {
    const r = assessRisk(clean({ prev: { lat: -7.75, lng: 110.37, accuracy: 10, atMs: NOW - 2 * 3_600_000 } }));
    expect(r.flags).not.toContain("IMPOSSIBLE_TRAVEL");
  });
});

describe("assessRisk — sinyal aplikasi lokasi palsu", () => {
  it("penanda mock dari aplikasi pembungkus → skor 100", () => {
    const r = assessRisk(clean({ reading: { ...clean().reading, mocked: true } }));
    expect(r.flags).toContain("MOCK_REPORTED");
    expect(r.score).toBe(100);
  });
  it("pembacaan basi (umur > 60 dtk) dan di masa depan; jam perangkat salah diabaikan karena selisih dihitung dengan jam yang sama", () => {
    const base = clean().reading;
    expect(assessRisk(clean({ reading: { ...base, timestamp: NOW - 120_000, clientNow: NOW } })).flags).toContain("STALE_READING");
    expect(assessRisk(clean({ reading: { ...base, timestamp: NOW + 30_000, clientNow: NOW } })).flags).toContain("FUTURE_READING");
    // jam perangkat mundur 2 jam, tetapi pembacaan baru menurut jam itu sendiri → tidak basi; hanya selisih jam yang ditandai bila > 5 menit
    const skewed = assessRisk(clean({ reading: { ...base, timestamp: NOW - 7_200_000 - 1000, clientNow: NOW - 7_200_000 } }));
    expect(skewed.flags).not.toContain("STALE_READING");
    expect(skewed.flags).toContain("CLOCK_SKEW");
  });
  it("tanpa data waktu pembacaan (permintaan buatan tangan) → MISSING_TELEMETRY", () => {
    expect(assessRisk(clean({ reading: { lat: -7.7956123, lng: 110.3695876, accuracy: 8, timestamp: null, clientNow: null } })).flags).toContain("MISSING_TELEMETRY");
  });
  it("akurasi < 1 m, koordinat ≤ 4 desimal, tepat di pusat kantor", () => {
    const r = assessRisk(clean({ reading: { lat: -7.7956, lng: 110.3695, accuracy: 0, timestamp: NOW - 100, clientNow: NOW }, distanceToCenter: 0 }));
    expect(r.flags).toEqual(expect.arrayContaining(["ACCURACY_PERFECT", "COORDS_LOW_PRECISION", "EXACT_CENTER"]));
    expect(r.score).toBe(30 + 25 + 40);
  });
  it("koordinat dengan 6+ desimal tidak dianggap berpresisi rendah; satu sumbu panjang cukup", () => {
    expect(assessRisk(clean({ reading: { ...clean().reading, lat: -7.7956, lng: 110.369587654 } })).flags).not.toContain("COORDS_LOW_PRECISION");
  });
  it("teleportasi: 400 km dalam 1 jam → mustahil; 400 km dalam 8 jam → wajar", () => {
    const prev = { lat: -7.8, lng: 110.37, accuracy: 10, atMs: NOW - 3_600_000 };
    const far = { ...clean().reading, lat: -4.2, lng: 110.37 }; // ± 400 km ke utara
    const fast = assessRisk(clean({ reading: far, prev }));
    expect(fast.flags).toContain("IMPOSSIBLE_TRAVEL");
    expect(Number(fast.details.impliedKmh)).toBeGreaterThan(250);
    expect(assessRisk(clean({ reading: far, prev: { ...prev, atMs: NOW - 8 * 3_600_000 } })).flags).not.toContain("IMPOSSIBLE_TRAVEL");
  });
  it("koordinat GPS identik dengan pembacaan sebelumnya / dengan karyawan lain (akurasi setara GPS)", () => {
    const rd = clean().reading;
    expect(assessRisk(clean({ prev: { lat: rd.lat, lng: rd.lng, accuracy: 8.4, atMs: NOW - 3_600_000 } })).flags).toContain("REPEAT_COORDS");
    expect(assessRisk(clean({ sharedCoordsWithOther: true })).flags).toContain("SHARED_COORDS");
  });
  it("perangkat baru / perangkat dipakai bergantian dengan karyawan lain", () => {
    expect(assessRisk(clean({ deviceKnown: false })).flags).toContain("NEW_DEVICE");
    expect(assessRisk(clean({ deviceKnown: null })).flags).not.toContain("NEW_DEVICE"); // perangkat pertama = baseline
    expect(assessRisk(clean({ sharedDeviceWithOther: true })).flags).toContain("SHARED_DEVICE");
  });
});

describe("jaringan kantor & keputusan", () => {
  it("dari jaringan kantor menurunkan skor (-30) tetapi tidak di bawah 0; di luar jaringan menambah 25", () => {
    expect(assessRisk(clean({ network: "INSIDE" })).score).toBe(0);
    const weak = assessRisk(clean({ network: "INSIDE", reading: { ...clean().reading, accuracy: 0 } }));
    expect(weak.score).toBe(0); // 30 − 30
    expect(assessRisk(clean({ network: "OUTSIDE" })).score).toBe(25);
  });
  it("jaringan kantor mengimbangi satu sinyal lemah, tetapi tidak menghapus beberapa sinyal kuat", () => {
    const lowPrec = { ...clean().reading, lat: -7.7956, lng: 110.3695 };
    expect(assessRisk(clean({ reading: lowPrec, network: "INSIDE" })).score).toBe(0);
    const strong = assessRisk(clean({ reading: { ...lowPrec, accuracy: 0 }, distanceToCenter: 0, network: "INSIDE" }));
    expect(strong.score).toBeGreaterThanOrEqual(FLAG_AT);
  });
  it("decide: OFF selalu terima; FLAG tidak pernah menolak; BLOCK menolak ≥ 70 dan menandai 50–69", () => {
    expect(decide("OFF", 100)).toBe("ACCEPTED");
    expect(decide("FLAG", 100)).toBe("FLAGGED");
    expect(decide("FLAG", 49)).toBe("ACCEPTED");
    expect(decide("BLOCK", BLOCK_AT)).toBe("BLOCKED");
    expect(decide("BLOCK", BLOCK_AT - 1)).toBe("FLAGGED");
    expect(decide("BLOCK", FLAG_AT - 1)).toBe("ACCEPTED");
  });
  it("pesan penolakan memuat alasan tetapi tidak memuat angka skor/ambang", () => {
    const m = blockedMessage(["MOCK_REPORTED", "ACCURACY_PERFECT", "INSIDE_OFFICE_NETWORK"]);
    expect(m).toContain("lokasi tiruan");
    expect(m).not.toMatch(/\b(100|70|50)\b/);
    expect(m).not.toContain("menurunkan risiko");
  });
});

describe("pencocokan IP / CIDR", () => {
  it("IPv4 tunggal & CIDR", () => {
    expect(ipInNetworks("203.0.113.7", ["203.0.113.0/24"])).toBe(true);
    expect(ipInNetworks("203.0.114.7", ["203.0.113.0/24"])).toBe(false);
    expect(ipInNetworks("198.51.100.9", ["198.51.100.9"])).toBe(true);
    expect(ipInNetworks("198.51.100.10", ["198.51.100.9"])).toBe(false);
    expect(ipInNetworks("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipInNetworks("1.2.3.4", ["0.0.0.0/0"])).toBe(true);
  });
  it("batas prefix tepat (/31, /32)", () => {
    expect(ipInNetworks("192.0.2.1", ["192.0.2.0/31"])).toBe(true);
    expect(ipInNetworks("192.0.2.2", ["192.0.2.0/31"])).toBe(false);
    expect(ipInNetworks("192.0.2.2", ["192.0.2.2/32"])).toBe(true);
  });
  it("IPv6 & IPv4-mapped", () => {
    expect(ipInNetworks("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(ipInNetworks("2001:db9::1", ["2001:db8::/32"])).toBe(false);
    expect(ipInNetworks("::ffff:203.0.113.7", ["203.0.113.0/24"])).toBe(true);
    expect(ipInNetworks("203.0.113.7", ["::ffff:203.0.113.0/120"])).toBe(true);
    expect(ipInNetworks("[2001:db8:0:0:0:0:0:5]", ["2001:db8::5"])).toBe(true);
  });
  it("masukan tak valid ditolak dengan aman (tidak pernah cocok, tidak melempar)", () => {
    expect(ipInNetworks(null, ["10.0.0.0/8"])).toBe(false);
    expect(ipInNetworks("bukan-ip", ["10.0.0.0/8"])).toBe(false);
    expect(ipInNetworks("10.0.0.1", ["sampah", "10.0.0.0/99", ""])).toBe(false);
    for (const bad of ["", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.4/33", "::1/129", "1.2.3.4/", "1.2.3.4/8/8", "01.2.3.4", "gggg::1"]) expect(isValidNetwork(bad), bad).toBe(false);
    expect(parseNetwork("203.0.113.77/24")!.prefix).toBe(24);
  });
});

describe("alamat klien dari X-Forwarded-For", () => {
  it("memakai entri yang ditambahkan proxy tepercaya (kanan), bukan yang dikirim klien (kiri) — anti pemalsuan jaringan kantor", () => {
    // Klien jahat mengirim "X-Forwarded-For: 203.0.113.7" (IP kantor); proxy menambahkan alamat asli di kanan.
    expect(clientIpFromForwardedFor("203.0.113.7, 198.51.100.99")).toBe("198.51.100.99");
    expect(clientIpFromForwardedFor("198.51.100.99")).toBe("198.51.100.99");
    expect(clientIpFromForwardedFor(" 198.51.100.99 ")).toBe("198.51.100.99");
  });
  it("dua proxy tepercaya (mis. CDN → Nginx): entri ke-2 dari kanan; entri kurang dari jumlah proxy → paling kiri yang ada", () => {
    expect(clientIpFromForwardedFor("6.6.6.6, 198.51.100.5, 10.0.0.2", 2)).toBe("198.51.100.5");
    expect(clientIpFromForwardedFor("198.51.100.5", 2)).toBe("198.51.100.5");
  });
  it("kosong / sampah / terlalu panjang → null; hops tak valid dianggap 1", () => {
    expect(clientIpFromForwardedFor(null)).toBeNull();
    expect(clientIpFromForwardedFor("")).toBeNull();
    expect(clientIpFromForwardedFor(" , ,")).toBeNull();
    expect(clientIpFromForwardedFor("x".repeat(65))).toBeNull();
    expect(clientIpFromForwardedFor("1.1.1.1, 2.2.2.2", 0)).toBe("2.2.2.2");
    expect(clientIpFromForwardedFor("1.1.1.1, 2.2.2.2", Number.NaN)).toBe("2.2.2.2");
  });
});

