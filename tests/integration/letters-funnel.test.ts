/**
 * Persuratan tahap 3: data komersial penawaran, status corong (aturan Deal wajib nilai + bukti), register & dasbor (Excel 1:1 + per PIC/bulan),
 * ekspor CSV, pengingat follow-up, tautan proyek Training, akses Manajer/Direktur.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { resetDb, makeUser } from "../helpers/db";
import { createLetter, updateLetter, submitLetter, approveLetter, getLetter, cancelLetter } from "@/server/services/letters/documents";
import { listTypes } from "@/server/services/letters/types";
import { createProjectFromLetter, getCommercial, runFollowUpReminders, setCommercialStatus, updateCommercial, uploadDealEvidence } from "@/server/services/letters/commercial";
import { exportRegisterCsv, funnelDashboard, listRegister } from "@/server/services/letters/register";
import { doc, p } from "@/lib/documents/builders";
import { todayIso, addDays } from "@/lib/time";

let direktur: Actor, manajer: Actor, staf: Actor, staf2: Actor;
const fail = async (pr: Promise<unknown>) => { try { await pr; return null; } catch (e) { return e as AppError; } };
const FORBIDDEN = { code: "FORBIDDEN" }, NOT_FOUND = { code: "NOT_FOUND" }, VALIDATION = { code: "VALIDATION" }, CONFLICT = { code: "CONFLICT" };
const today = () => todayIso("Asia/Jakarta");
async function emp(no: string, name: string, extra: Record<string, unknown> = {}) {
  return prisma.employee.create({ data: { employeeNo: no, fullName: name, position: name, joinDate: isoToDate("2026-01-05"), employmentStatus: "PERMANENT", ...extra } as never });
}
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

/** Terbitkan satu penawaran B2B (EKS-002) yang ditandatangani Direktur. */
async function issued(subject = "Penawaran In-House", signer: Actor = direktur) {
  await listTypes(direktur);
  const t = await prisma.letterType.findFirstOrThrow({ where: { series: "EKS", code: 2 } });
  const d = await createLetter(staf, { typeId: t.id });
  await updateLetter(staf, d.id, { subject, recipientLines: ["Bapak Klien", "PT Klien"], signerId: signer.userId, body: doc(p("Isi penawaran final.")) });
  await submitLetter(staf, d.id);
  return approveLetter(signer, d.id);
}

beforeEach(async () => {
  await resetDb();
  direktur = await makeUser("dir@uji.test", "Direktur Uji", "SUPER_ADMIN", (await emp("D-1", "Direktur Utama")).id);
  manajer = await makeUser("mgr@uji.test", "Manajer Pemasaran", "EMPLOYEE", (await emp("M-1", "Manajer Pemasaran", { jobLevel: "MANAGER" })).id);
  staf = await makeUser("staf@uji.test", "Staf Admisi", "EMPLOYEE", (await emp("S-1", "Staf Admisi")).id);
  staf2 = await makeUser("staf2@uji.test", "Staf Lain", "EMPLOYEE", (await emp("S-2", "Staf Lain")).id);
});

describe("data komersial & status corong", () => {
  it("penawaran terbit belum dikirim = Draft; tandai Terkirim mengisi tanggal kirim; jenis non-corong ditolak", async () => {
    const l = await issued();
    const c0 = await getCommercial(staf, l.id);
    expect(c0).toMatchObject({ funnel: true, status: "DRAFT", statusLabel: "Draft" });
    await updateCommercial(staf, l.id, { clientName: "PT Klien Contoh", product: "BNSP Tata Boga / Food Production", potentialValue: 45_000_000, picId: staf.userId, followUpAt: addDays(today(), 3), clientRef: "LEAD-123" });
    const c1 = await setCommercialStatus(staf, l.id, { to: "SENT" });
    expect(c1).toMatchObject({ status: "SENT", clientName: "PT Klien Contoh", potentialValue: 45_000_000, picName: "Staf Admisi", clientRef: "LEAD-123", sentAt: today() });
    // jenis non-corong
    const t = await prisma.letterType.findFirstOrThrow({ where: { series: "EKS", code: 6 } });
    const u = await createLetter(staf, { typeId: t.id });
    expect(await fail(updateCommercial(staf, u.id, { product: "x" }))).toMatchObject(VALIDATION);
  });

  it("Deal wajib nilai + bukti/catatan; bukti PDF/JPG saja; Selesai hanya dari Deal; perubahan tercatat di riwayat", async () => {
    const l = await issued();
    await setCommercialStatus(staf, l.id, { to: "SENT" });
    await setCommercialStatus(staf, l.id, { to: "NEGOTIATION" });
    expect(await fail(setCommercialStatus(staf, l.id, { to: "DEAL" }))).toMatchObject(VALIDATION); // tanpa nilai & bukti
    expect(await fail(setCommercialStatus(staf, l.id, { to: "DEAL", dealValue: 40_000_000 }))).toMatchObject(VALIDATION); // tanpa bukti/catatan
    expect(await fail(uploadDealEvidence(staf, l.id, { name: "po.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) }))).toMatchObject(VALIDATION); // PNG tidak diizinkan
    expect(await fail(uploadDealEvidence(staf, l.id, { name: "po.pdf", bytes: new TextEncoder().encode("bukan pdf") }))).toMatchObject(VALIDATION);
    const withEv = await uploadDealEvidence(staf, l.id, { name: "po.jpg", bytes: jpg });
    expect(withEv.evidence?.name).toMatch(/po\.jpg$/);
    const deal = await setCommercialStatus(staf, l.id, { to: "DEAL", dealValue: 40_000_000 });
    expect(deal).toMatchObject({ status: "DEAL", dealValue: 40_000_000, followUpAt: null });
    expect(await fail(setCommercialStatus(staf, l.id, { to: "DONE" }))).toBeNull();
    expect(await fail(setCommercialStatus(staf, l.id, { to: "FOLLOW_UP" }))).toMatchObject(CONFLICT); // selesai final
    // catatan saja pun cukup sebagai bukti
    const l2 = await issued("Penawaran kedua");
    await setCommercialStatus(staf, l2.id, { to: "SENT" });
    expect((await setCommercialStatus(staf, l2.id, { to: "DEAL", dealValue: 10_000_000, note: "PO via WhatsApp 10/11" })).status).toBe("DEAL");
    const ev = (await getLetter(staf, l.id)).events.filter((e) => e.action === "COMMERCIAL_STATUS").map((e) => e.note);
    expect(ev[0]).toContain("Draft → Terkirim"); expect(ev.some((n) => n?.includes("Negosiasi → Deal"))).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "letter.commercial_status" } })).toBeGreaterThanOrEqual(5);
  });

  it("akses: pembuat/PIC/Direktur/Manajer boleh; staf lain tidak melihat (404); bukti hanya terbuka bagi yang berhak", async () => {
    const l = await issued();
    expect(await fail(getCommercial(staf2, l.id))).toMatchObject(NOT_FOUND);
    expect((await getCommercial(manajer, l.id)).can.edit).toBe(true); // Manajer memantau corong
    expect((await getCommercial(direktur, l.id)).can.setStatus).toBe(true);
    await updateCommercial(staf, l.id, { picId: staf2.userId });
    expect((await getCommercial(staf2, l.id)).can.edit).toBe(true); // PIC kini dapat melihat & mengelola
    await setCommercialStatus(staf, l.id, { to: "SENT" });
    await uploadDealEvidence(staf, l.id, { name: "po.pdf", bytes: pdf }).catch(() => null);
    const { canReadLetterPdf } = await import("@/server/services/letters/access");
    const ev = (await prisma.letterDocument.findUniqueOrThrow({ where: { id: l.id } })).dealEvidenceFileId;
    if (ev) { expect(await canReadLetterPdf(manajer, ev)).toBe(true); expect(await canReadLetterPdf(staf2, ev)).toBe(true); }
    expect(await fail(cancelLetter(direktur, l.id, { note: "Salah kirim" }))).toBeNull();
    expect(await fail(setCommercialStatus(staf, l.id, { to: "FOLLOW_UP" }))).toMatchObject(CONFLICT);
  });

  it("buat proyek in-house dari penawaran Deal (hanya Deal; hanya yang berwenang membuat proyek); tautan tercatat", async () => {
    const l = await issued();
    expect(await fail(createProjectFromLetter(direktur, l.id, {}))).toMatchObject(CONFLICT); // belum Deal
    await setCommercialStatus(staf, l.id, { to: "SENT" });
    await updateCommercial(staf, l.id, { clientName: "PT Klien Contoh" });
    await setCommercialStatus(staf, l.id, { to: "DEAL", dealValue: 25_000_000, note: "PO diterima" });
    expect(await fail(createProjectFromLetter(staf, l.id, {}))).toBeTruthy(); // staf biasa tidak boleh membuat proyek Training
    const c = await createProjectFromLetter(direktur, l.id, { name: "In-House Food Production PT Klien" });
    expect(c.projects).toHaveLength(1);
    const proj = await prisma.trainingProject.findUniqueOrThrow({ where: { id: c.projects[0]!.projectId } });
    expect(proj).toMatchObject({ kind: "IN_HOUSE", clientName: "PT Klien Contoh" });
    expect(proj.notes).toContain(l.number!);
    expect(await prisma.letterProjectLink.count({ where: { documentId: l.id } })).toBe(1);
  });
});

describe("register, dasbor, CSV, pengingat", () => {
  it("dasbor menghitung seperti Excel: terkirim, pipeline, deal, tolak, konversi, win rate, nilai, capaian target, per jenis/status/produk/PIC/bulan", async () => {
    const a = await issued("Penawaran A"), b = await issued("Penawaran B"), c = await issued("Penawaran C"), d = await issued("Penawaran D");
    for (const [l, prod, pot] of [[a, "BNSP Tata Boga / Food Production", 40_000_000], [b, "BNSP Tata Boga / Food Production", 20_000_000], [c, "AI & Pemasaran Digital", 10_000_000], [d, null, 5_000_000]] as const)
      await updateCommercial(staf, l.id, { product: prod, potentialValue: pot, picId: staf.userId, followUpAt: addDays(today(), -1) });
    await setCommercialStatus(staf, a.id, { to: "SENT" }); await setCommercialStatus(staf, a.id, { to: "DEAL", dealValue: 38_000_000, note: "PO diterima" });
    await setCommercialStatus(staf, b.id, { to: "SENT" }); await setCommercialStatus(staf, b.id, { to: "REJECTED", note: "Anggaran tidak ada" });
    await setCommercialStatus(staf, c.id, { to: "SENT" }); // pipeline, FU terlambat
    // d tetap Draft (belum dikirim)
    const dash = await funnelDashboard(direktur, {});
    expect(dash.summary).toMatchObject({ issued: 4, cancelled: 0, offersSent: 3, pipeline: 1, deal: 1, rejected: 1, overdueFollowUp: 1, pipelineValue: 10_000_000, dealValue: 38_000_000 });
    expect(dash.summary.conversion).toBeCloseTo(1 / 3); expect(dash.summary.winRate).toBeCloseTo(0.5); expect(dash.summary.targetAchievement).toBeCloseTo(38_000_000 / 10_000_000_000);
    expect(dash.target).toBe(10_000_000_000);
    expect(dash.perType.find((t) => t.code === "EKS-002")).toMatchObject({ count: 4, deal: 1, dealValue: 38_000_000 });
    expect(dash.perStatus.find((s) => s.status === "SENT")?.count).toBe(1);
    expect(dash.perProduct.find((x) => x.product === "BNSP Tata Boga / Food Production")).toMatchObject({ count: 2, offersSent: 2, deal: 1 });
    expect(dash.perPic[0]).toMatchObject({ pic: "Staf Admisi", offers: 3, deal: 1, dealValue: 38_000_000 });
    expect(dash.perMonth.reduce((s, m) => s + m.issued, 0)).toBe(4);
    // Manajer boleh melihat dasbor corong; staf tidak
    expect((await funnelDashboard(manajer, {})).summary.issued).toBe(4);
    expect(await fail(funnelDashboard(staf, {}))).toMatchObject(FORBIDDEN);
  });

  it("register: kolom Excel, alert FU TERLAMBAT, filter; CSV aman dari formula injection & tercatat di audit; Manajer tak melihat surat non-corong", async () => {
    const l = await issued("=HYPERLINK(\"x\")");
    await updateCommercial(staf, l.id, { clientName: "PT Klien", followUpAt: addDays(today(), -2), potentialValue: 5_000_000 });
    await setCommercialStatus(staf, l.id, { to: "SENT" });
    const sk = await prisma.letterType.findFirstOrThrow({ where: { series: "INT", code: 1 } });
    const k = await createLetter(staf, { typeId: sk.id });
    await updateLetter(staf, k.id, { signerId: direktur.userId, body: doc(p("Isi SK final.")) }); await submitLetter(staf, k.id); await approveLetter(direktur, k.id);
    const reg = await listRegister(direktur, {});
    expect(reg.total).toBe(2);
    const row = reg.items.find((r) => r.typeCode === "EKS-002")!;
    expect(row).toMatchObject({ statusLabel: "Terkirim", alert: "TERLAMBAT", recipient: "PT Klien", potentialValue: 5_000_000, funnel: true });
    expect((await listRegister(direktur, { status: "SENT" })).total).toBe(1);
    expect((await listRegister(manajer, {})).total).toBe(1); // hanya jenis corong
    expect(await fail(listRegister(staf, {}))).toMatchObject(FORBIDDEN);
    const csv = await exportRegisterCsv(direktur, {});
    expect(csv).toContain("Nomor Surat"); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain("TERLAMBAT");
    expect(await prisma.auditLog.count({ where: { action: "letter.register_export" } })).toBe(1);
  });

  it("pengingat follow-up: sekali per hari per surat ke PIC; tidak dikirim bila belum jatuh tempo atau status sudah diputuskan", async () => {
    const a = await issued("Penawaran A"), b = await issued("Penawaran B"), c = await issued("Penawaran C");
    await updateCommercial(staf, a.id, { picId: staf2.userId, followUpAt: addDays(today(), -1) }); await setCommercialStatus(staf, a.id, { to: "FOLLOW_UP" });
    await updateCommercial(staf, b.id, { followUpAt: addDays(today(), 5) }); await setCommercialStatus(staf, b.id, { to: "SENT" });
    await updateCommercial(staf, c.id, { followUpAt: addDays(today(), -1) }); await setCommercialStatus(staf, c.id, { to: "REJECTED", note: "Ditolak klien" });
    const r1 = await runFollowUpReminders();
    expect(r1.sent).toBe(1);
    const n = await prisma.notification.findMany({ where: { type: "letter.followup" } });
    expect(n).toHaveLength(1); expect(n[0]!.userId).toBe(staf2.userId); expect(n[0]!.title).toContain("TERLAMBAT");
    expect((await runFollowUpReminders()).sent).toBe(0); // idempoten di hari yang sama
  });
});
