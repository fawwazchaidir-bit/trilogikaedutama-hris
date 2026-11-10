import { describe, expect, it } from "vitest";
import { canTransition, dealProblems, displayStatus, followUpAlert, isWon } from "@/lib/documents/commercial";

describe("corong penjualan (aturan murni)", () => {
  it("status tampilan diturunkan dari siklus surat + status komersial", () => {
    expect(displayStatus({ letterStatus: "DRAFT", commercialStatus: null })).toBe("DRAFT");
    expect(displayStatus({ letterStatus: "IN_REVIEW", commercialStatus: null })).toBe("DRAFT");
    expect(displayStatus({ letterStatus: "ISSUED", commercialStatus: null })).toBe("DRAFT");
    expect(displayStatus({ letterStatus: "ISSUED", commercialStatus: "NEGOTIATION" })).toBe("NEGOTIATION");
    expect(displayStatus({ letterStatus: "CANCELLED", commercialStatus: "DEAL" })).toBe("CANCELLED");
    expect(displayStatus({ letterStatus: "REJECTED", commercialStatus: null })).toBe("CANCELLED");
  });
  it("Deal wajib nilai + bukti atau catatan", () => {
    expect(dealProblems({ dealValue: null, hasEvidence: false, note: null })).toHaveLength(2);
    expect(dealProblems({ dealValue: 10, hasEvidence: false, note: "  " })).toHaveLength(1);
    expect(dealProblems({ dealValue: 10, hasEvidence: true, note: null })).toEqual([]);
    expect(dealProblems({ dealValue: 10, hasEvidence: false, note: "PO via WA" })).toEqual([]);
  });
  it("perpindahan status: Selesai hanya dari Deal dan final; batal tak dapat diubah", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(true);
    expect(canTransition("DRAFT", "DONE")).toBe(false);
    expect(canTransition("DEAL", "DONE")).toBe(true);
    expect(canTransition("DONE", "SENT")).toBe(false);
    expect(canTransition("CANCELLED", "SENT")).toBe(false);
    expect(canTransition("SENT", "SENT")).toBe(false);
    expect(canTransition("REJECTED", "NEGOTIATION")).toBe(true); // keputusan dapat dikoreksi
  });
  it("menang = Deal atau Selesai bernilai; alert FU hanya untuk pipeline", () => {
    expect(isWon("DEAL", null)).toBe(true); expect(isWon("DONE", 5)).toBe(true); expect(isWon("DONE", 0)).toBe(false); expect(isWon("SENT", 5)).toBe(false);
    expect(followUpAlert("SENT", "2026-11-01", "2026-11-10")).toBe("TERLAMBAT");
    expect(followUpAlert("FOLLOW_UP", "2026-11-10", "2026-11-10")).toBe("HARI_INI");
    expect(followUpAlert("DEAL", "2026-11-01", "2026-11-10")).toBeNull();
    expect(followUpAlert("SENT", null, "2026-11-10")).toBeNull();
  });
});
