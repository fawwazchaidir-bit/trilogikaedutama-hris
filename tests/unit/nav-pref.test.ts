import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_PREF, NAV_GROUP_IDS, parseNavPref, serializeNavPref } from "@/lib/nav-pref";

describe("preferensi sidebar (cookie)", () => {
  it("bawaan: sidebar terbuka dan semua grup terbuka (cookie kosong/tidak ada)", () => {
    expect(parseNavPref(undefined)).toEqual(DEFAULT_NAV_PREF);
    expect(parseNavPref("")).toEqual(DEFAULT_NAV_PREF);
    expect(parseNavPref(null)).toEqual({ collapsed: false, closedGroups: [] });
  });

  it("round-trip: menulis lalu membaca menghasilkan nilai yang sama", () => {
    for (const p of [{ collapsed: true, closedGroups: ["training", "sistem"] }, { collapsed: false, closedGroups: ["sdm"] }, { collapsed: true, closedGroups: [] }] as const) {
      expect(parseNavPref(serializeNavPref({ collapsed: p.collapsed, closedGroups: [...p.closedGroups] }))).toEqual(p);
    }
    expect(serializeNavPref({ collapsed: true, closedGroups: ["training"] })).toBe("1:training");
  });

  it("nilai tak dipercaya: grup asing & 'umum' dibuang, duplikat digabung, nilai ngawur/terlalu panjang diabaikan", () => {
    expect(parseNavPref("0:training.training.<script>.umum.sistem").closedGroups).toEqual(["training", "sistem"]);
    expect(parseNavPref("x:training").collapsed).toBe(false);
    expect(parseNavPref("1").collapsed).toBe(true); // tanpa ":" → bendera tetap dibaca, grup kosong
    expect(parseNavPref("a".repeat(500))).toEqual(DEFAULT_NAV_PREF);
    expect((NAV_GROUP_IDS as readonly string[]).includes("training")).toBe(true);
  });
});
