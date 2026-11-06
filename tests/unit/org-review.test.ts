import { describe, expect, it } from "vitest";
import { reviewCapacity, reviewableTargets, reviewersOf, supervisorChain, wouldCreateCycle, type OrgGraph, type OrgNode } from "@/lib/org-review";

/** Bagan uji: Direktur(D) ← Manajer(M) ← Supervisor(S) ← {Sari, Tono}; Rina berdiri sendiri (tanpa atasan). */
function graph(over: { away?: string[]; delegates?: Record<string, string[]>; inactive?: string[]; sup?: Record<string, string | null> } = {}): OrgGraph {
  const sup: Record<string, string | null> = { D: null, M: "D", S: "M", Sari: "S", Tono: "S", Rina: null, ...over.sup };
  const nodes = new Map<string, OrgNode>(Object.entries(sup).map(([id, supervisorId]) => [id, { id, supervisorId, active: !(over.inactive ?? []).includes(id) }]));
  return { nodes, away: new Set(over.away ?? []), delegates: new Map(Object.entries(over.delegates ?? {}).map(([k, v]) => [k, new Set(v)])) };
}

describe("reviewersOf / reviewCapacity", () => {
  it("atasan langsung berwenang atas bawahannya; orang lain (rekan, bawahan, atasan atasan yang hadir) tidak", () => {
    const g = graph();
    expect(reviewCapacity(g, "S", "Sari")).toBe("SUPERVISOR");
    expect(reviewCapacity(g, "Tono", "Sari")).toBeNull();
    expect(reviewCapacity(g, "M", "Sari")).toBeNull(); // atasan hadir → tidak naik
    expect(reviewCapacity(g, "Sari", "S")).toBeNull();  // bawahan atas atasan
    expect(reviewersOf(g, "Rina")).toEqual([]);         // tanpa atasan → diproses HR seperti semula
  });
  it("tidak seorang pun berwenang atas pengajuannya sendiri", () => {
    const g = graph();
    expect(reviewCapacity(g, "Sari", "Sari")).toBeNull();
    expect(reviewCapacity(g, "S", "S")).toBeNull();
  });
  it("atasan cuti tanpa pengganti → naik ke atasannya (eskalasi); atasan tetap berwenang", () => {
    const g = graph({ away: ["S"] });
    expect(reviewCapacity(g, "M", "Sari")).toBe("ESCALATION");
    expect(reviewCapacity(g, "S", "Sari")).toBe("SUPERVISOR");
    expect(reviewCapacity(g, "D", "Sari")).toBeNull(); // M hadir → berhenti di M
  });
  it("atasan cuti DENGAN pengganti → pengganti berwenang, tidak ada eskalasi", () => {
    const g = graph({ away: ["S"], delegates: { S: ["Tono"] } });
    expect(reviewCapacity(g, "Tono", "Sari")).toBe("DELEGATE");
    expect(reviewCapacity(g, "M", "Sari")).toBeNull();
  });
  it("pengganti hanya berlaku untuk bawahan langsung atasan yang digantikan, dan tidak untuk pengajuannya sendiri", () => {
    const g = graph({ delegates: { S: ["Tono"] } });
    expect(reviewCapacity(g, "Tono", "Sari")).toBe("DELEGATE");
    expect(reviewCapacity(g, "Tono", "Tono")).toBeNull();
    expect(reviewCapacity(g, "Tono", "S")).toBeNull();     // pengganti S tidak meninjau pengajuan S sendiri-nya atasan
    expect(reviewCapacity(g, "Tono", "Rina")).toBeNull();
  });
  it("atasan nonaktif tanpa pengganti → eskalasi ke atasannya; nonaktif tidak pernah berwenang", () => {
    const g = graph({ inactive: ["S"] });
    expect(reviewCapacity(g, "S", "Sari")).toBeNull();
    expect(reviewCapacity(g, "M", "Sari")).toBe("ESCALATION");
  });
  it("eskalasi berlapis: S dan M sama-sama tidak ada → Direktur; dibatasi tiga tingkat", () => {
    const g = graph({ away: ["S", "M"] });
    expect(reviewCapacity(g, "D", "Sari")).toBe("ESCALATION");
    expect(reviewersOf(g, "Sari").map((r) => r.employeeId).sort()).toEqual(["D", "M", "S"]);
    const deep = graph({ sup: { A: "B", B: "C", C: "E", E: "F", F: null }, away: ["B", "C", "E"] });
    expect(supervisorChain(deep, "A").map((n) => n.id)).toEqual(["B", "C", "E"]); // F di luar batas tiga tingkat
    expect(reviewCapacity(deep, "F", "A")).toBeNull();
  });
  it("pengganti di tingkat eskalasi ikut berwenang", () => {
    const g = graph({ away: ["S", "M"], delegates: { M: ["Rina"] } });
    expect(reviewCapacity(g, "Rina", "Sari")).toBe("DELEGATE");
  });
});

describe("reviewableTargets & wouldCreateCycle", () => {
  it("daftar pengajuan yang boleh ditinjau: bawahan langsung + yang dieskalasi + yang digantikan", () => {
    const g = graph({ away: ["S"], delegates: { S: [] } });
    expect([...reviewableTargets(g, "S").keys()].sort()).toEqual(["Sari", "Tono"]);
    expect([...reviewableTargets(g, "M").entries()].sort()).toEqual([["S", "SUPERVISOR"], ["Sari", "ESCALATION"], ["Tono", "ESCALATION"]]);
    const h = graph({ delegates: { S: ["Rina"] } });
    expect([...reviewableTargets(h, "Rina").keys()].sort()).toEqual(["Sari", "Tono"]);
    expect(reviewableTargets(h, "Sari").size).toBe(0);
  });
  it("rantai melingkar terdeteksi (diri sendiri, bawahan, bawahan tidak langsung); atasan yang sah tidak", () => {
    const g = graph();
    expect(wouldCreateCycle(g, "S", "S")).toBe(true);
    expect(wouldCreateCycle(g, "M", "Sari")).toBe(true);  // Sari berada di bawah M
    expect(wouldCreateCycle(g, "D", "Tono")).toBe(true);
    expect(wouldCreateCycle(g, "Sari", "M")).toBe(false);
    expect(wouldCreateCycle(g, "Rina", "D")).toBe(false);
  });
});
