import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { archiveDocument, createDocument, decideRenewal, documentAttentionCount, getDocument, listDocuments, listMyDocuments, readDocumentFile, runContractReminders } from "@/server/services/documents";
import { listNotifications } from "@/server/services/notifications";
import { readFileForActor } from "@/server/services/files";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";
import { pinNow } from "../helpers/pin-now";

pinNow(); // 1 Nov 2026 (WIB)

let fx: Fixtures;
const NOW = new Date("2026-11-01T03:00:00Z");
const at = (iso: string) => new Date(`${iso}T03:00:00Z`);
const pdf = (name = "kontrak.pdf") => ({ name, bytes: new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n") });
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const contract = (over: Record<string, unknown> = {}) => ({ employeeId: fx.empIds[0], kind: "CONTRACT", title: "PKWT I — Staf Operasional", startDate: "2026-03-01", endDate: "2027-03-01", ...over });
const notifTypes = async (a: typeof fx.superAdmin) => (await listNotifications(a, 100)).items.map((n) => n.type);

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
});

describe("unggah & akses dokumen", () => {
  it("HR mengunggah PDF kontrak: tersimpan sebagai berkas DOCUMENT, tercatat di audit, karyawan diberi tahu", async () => {
    const d = await createDocument(fx.hr, contract({ documentNo: "KTR/001/2026", note: "Bermaterai, basah" }), pdf(), NOW);
    expect(d).toMatchObject({ kind: "CONTRACT", employeeName: "Ayu Lestari", endDate: "2027-03-01", phase: "ACTIVE", decision: "PENDING", needsDecision: false, archived: false });
    expect(d.viewUrl).toBe(`/api/documents/${d.id}/file`);
    const row = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: d.id }, include: { file: true } });
    expect(row.file).toMatchObject({ kind: "DOCUMENT", mimeType: "application/pdf" });
    expect(row.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await prisma.auditLog.count({ where: { action: "document.create", entityId: d.id } })).toBe(1);
    expect(await notifTypes(fx.emp1)).toContain("document.added");
  });

  it("hanya PDF yang diterima (magic bytes); file kosong/bukan PDF/terlalu besar ditolak; karyawan tidak boleh mengunggah", async () => {
    const png = { name: "x.pdf", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]) };
    expect((await fail(createDocument(fx.hr, contract(), png, NOW)))?.message).toMatch(/Jenis file tidak diizinkan/);
    expect((await fail(createDocument(fx.hr, contract(), { name: "k.pdf", bytes: new Uint8Array() }, NOW)))?.message).toMatch(/kosong/);
    const big = new Uint8Array(11 * 1024 * 1024); big.set(new TextEncoder().encode("%PDF-1.4"));
    expect((await fail(createDocument(fx.hr, contract(), { name: "besar.pdf", bytes: big }, NOW)))?.message).toMatch(/maksimal 10 MB/);
    expect((await fail(createDocument(fx.emp1, contract(), pdf(), NOW)))?.code).toBe("FORBIDDEN");
    expect(await prisma.employeeDocument.count()).toBe(0);
    expect(await prisma.storedFile.count({ where: { kind: "DOCUMENT" } })).toBe(0); // transaksi dibatalkan → tidak ada berkas yatim
  });

  it("validasi: kontrak wajib tanggal mulai; tanggal berakhir tidak boleh sebelum mulai; kontrak tanpa batas waktu diizinkan", async () => {
    expect((await fail(createDocument(fx.hr, contract({ startDate: "" }), pdf(), NOW)))?.fieldErrors?.startDate).toBeTruthy();
    expect((await fail(createDocument(fx.hr, contract({ endDate: "2026-01-01" }), pdf(), NOW)))?.fieldErrors?.endDate).toBeTruthy();
    expect((await fail(createDocument(fx.hr, contract({ title: "" }), pdf(), NOW)))?.fieldErrors?.title).toBeTruthy();
    const pkwtt = await createDocument(fx.hr, contract({ title: "PKWTT Staf", endDate: "" }), pdf(), NOW);
    expect(pkwtt).toMatchObject({ endDate: null, phase: "NO_EXPIRY", daysLeft: null, needsDecision: false });
  });

  it("karyawan hanya melihat & membuka dokumennya sendiri; admin dapat membuka semuanya (dengan audit)", async () => {
    const mine = await createDocument(fx.hr, contract(), pdf("a.pdf"), NOW);
    const other = await createDocument(fx.hr, contract({ employeeId: fx.empIds[1], title: "PKWT Budi" }), pdf("b.pdf"), NOW);
    expect((await listMyDocuments(fx.emp1, NOW)).map((d) => d.id)).toEqual([mine.id]);
    expect((await readDocumentFile(fx.emp1, mine.id)).mimeType).toBe("application/pdf");
    expect((await fail(readDocumentFile(fx.emp1, other.id)))?.code).toBe("NOT_FOUND"); // tidak membocorkan keberadaan
    expect((await fail(getDocument(fx.emp1, other.id)))?.code).toBe("NOT_FOUND");
    expect((await fail(listDocuments(fx.emp1)))?.code).toBe("FORBIDDEN");
    const f = await readDocumentFile(fx.hr, other.id);
    expect(f.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await prisma.auditLog.count({ where: { action: "document.view", entityId: other.id } })).toBe(1);
    // Jalur berkas generik juga tidak membuka dokumen orang lain
    const fileId = (await prisma.employeeDocument.findUniqueOrThrow({ where: { id: other.id } })).fileId;
    expect((await fail(readFileForActor(fx.emp1, fileId)))?.code).toBe("FORBIDDEN");
    expect((await readFileForActor(fx.hr, fileId)).kind).toBe("DOCUMENT");
  });

  it("arsip (bukan hapus): alasan wajib, hilang dari daftar karyawan & pengingat berhenti; database menolak DELETE", async () => {
    const d = await createDocument(fx.hr, contract({ employeeId: fx.empIds[1] }), pdf(), NOW);
    expect((await fail(archiveDocument(fx.hr, d.id, { reason: "" })))?.code).toBe("VALIDATION");
    await archiveDocument(fx.hr, d.id, { reason: "Salah unggah, berkas milik karyawan lain" });
    expect((await listMyDocuments(fx.emp2, NOW))).toHaveLength(0);
    expect((await fail(readDocumentFile(fx.emp2, d.id)))?.code).toBe("NOT_FOUND");
    expect((await listDocuments(fx.hr, {}, NOW)).total).toBe(0);
    expect((await listDocuments(fx.hr, { view: "diarsipkan" }, NOW)).items.map((x) => x.id)).toEqual([d.id]);
    expect((await fail(archiveDocument(fx.hr, d.id, { reason: "Ulangi arsip" })))?.code).toBe("CONFLICT");
    await expect(prisma.employeeDocument.delete({ where: { id: d.id } })).rejects.toThrow(/tidak boleh dihapus/);
    expect((await runContractReminders(at("2027-02-20"))).sent).toBe(0);
  });
});

describe("pengingat H-3 bulan & keputusan pimpinan", () => {
  it("pimpinan (Super Admin) menerima pengingat tepat H-3 bulan; HR/karyawan tidak; tidak terkirim ganda", async () => {
    const d = await createDocument(fx.hr, contract(), pdf(), NOW); // berakhir 2027-03-01 → H-3 bulan = 2026-12-01
    expect(await runContractReminders(at("2026-11-30"))).toMatchObject({ checked: 1, sent: 0 });
    expect(await notifTypes(fx.superAdmin)).not.toContain("document.contract_expiring");

    const r1 = await runContractReminders(at("2026-12-01"));
    expect(r1).toMatchObject({ checked: 1, sent: 1 });
    const sa = (await listNotifications(fx.superAdmin, 50)).items.filter((n) => n.type === "document.contract_expiring");
    expect(sa).toHaveLength(1);
    expect(sa[0]).toMatchObject({ href: "/dokumen?view=perlu-keputusan" });
    expect(sa[0]!.title).toMatch(/Ayu Lestari/);
    expect(sa[0]!.body).toMatch(/H-3 bulan/);
    expect(await notifTypes(fx.hr)).not.toContain("document.contract_expiring");
    expect(await notifTypes(fx.emp1)).not.toContain("document.contract_expiring");

    // Berjalan lagi di hari yang sama & besoknya → tidak dikirim ulang (idempoten)
    expect((await runContractReminders(at("2026-12-01"))).sent).toBe(0);
    expect((await runContractReminders(at("2026-12-15"))).sent).toBe(0);
    expect((await prisma.employeeDocument.findUniqueOrThrow({ where: { id: d.id } })).remindersSent).toEqual(["M3"]);
    // Penegasan H-1 bulan dan H-14 hari selama belum diputuskan
    expect((await runContractReminders(at("2027-02-01"))).sent).toBe(1);
    expect((await runContractReminders(at("2027-02-15"))).sent).toBe(1);
    expect((await runContractReminders(at("2027-02-16"))).sent).toBe(0);
    expect((await listNotifications(fx.superAdmin, 50)).items.filter((n) => n.type === "document.contract_expiring")).toHaveLength(3);
  });

  it("pekerja dijalankan serentak → tetap satu pengingat", async () => {
    await createDocument(fx.hr, contract(), pdf(), NOW);
    await Promise.all(Array.from({ length: 4 }, () => runContractReminders(at("2026-12-05"))));
    expect((await listNotifications(fx.superAdmin, 50)).items.filter((n) => n.type === "document.contract_expiring")).toHaveLength(1);
  });

  it("kontrak diunggah saat sudah dalam jendela H-3 bulan → langsung diingatkan (tanpa menunggu pekerja)", async () => {
    await createDocument(fx.hr, contract({ endDate: "2027-01-15" }), pdf(), NOW); // 2026-11-01 sudah di dalam H-3 bulan
    expect((await listNotifications(fx.superAdmin, 50)).items.filter((n) => n.type === "document.contract_expiring")).toHaveLength(1);
    expect((await runContractReminders(NOW)).sent).toBe(0);
  });

  it("keputusan LANJUT: hanya Super Admin; menghentikan pengingat; HR diberi tahu; karyawan tidak; dapat dicatat ulang", async () => {
    const d = await createDocument(fx.hr, contract(), pdf(), NOW);
    await runContractReminders(at("2026-12-01"));
    expect((await fail(decideRenewal(fx.hr, d.id, { decision: "CONTINUE", note: null })))?.code).toBe("FORBIDDEN");
    expect((await fail(decideRenewal(fx.emp1, d.id, { decision: "CONTINUE", note: null })))?.code).toBe("FORBIDDEN");
    expect((await fail(decideRenewal(fx.superAdmin, d.id, { decision: "DISCONTINUE", note: "" })))?.fieldErrors?.note).toBeTruthy();

    const done = await decideRenewal(fx.superAdmin, d.id, { decision: "CONTINUE", note: "Kinerja baik" });
    expect(done).toMatchObject({ decision: "CONTINUE", decidedBy: "Pimpinan Uji", needsDecision: false });
    const hrNotif = (await listNotifications(fx.hr, 50)).items.find((n) => n.type === "document.decision");
    expect(hrNotif?.title).toMatch(/akan dilanjutkan/);
    expect(hrNotif?.body).toMatch(/unggah kontrak perpanjangan/i);
    expect(await notifTypes(fx.emp1)).not.toContain("document.decision");
    expect((await runContractReminders(at("2027-02-15"))).sent).toBe(0); // sudah diputuskan → tidak ada penegasan
    // Audit sebelum/sesudah
    const a = await prisma.auditLog.findFirst({ where: { action: "document.decide", entityId: d.id } });
    expect(a).toMatchObject({ reason: "Kinerja baik" });
    expect(a?.before).toMatchObject({ decision: "PENDING" });
    expect(a?.after).toMatchObject({ decision: "CONTINUE" });
    // Mengubah keputusan masih boleh (sebelum diperpanjang)
    expect((await decideRenewal(fx.superAdmin, d.id, { decision: "DISCONTINUE", note: "Anggaran dipangkas, tidak dilanjutkan" })).decision).toBe("DISCONTINUE");
    expect((await fail(decideRenewal(fx.superAdmin, d.id, { decision: "DISCONTINUE", note: "Anggaran dipangkas, tidak dilanjutkan" })))?.message).toMatch(/sudah sama/);
  });

  it("keputusan TIDAK LANJUT wajib beralasan; lencana menu: pimpinan → perlu keputusan, HR → perlu unggah perpanjangan", async () => {
    const d = await createDocument(fx.hr, contract({ endDate: "2027-01-15" }), pdf(), NOW);
    expect(await documentAttentionCount(fx.superAdmin)).toBe(1); // belum diputuskan & ≤ 3 bulan
    expect(await documentAttentionCount(fx.hr)).toBe(0);
    expect((await listDocuments(fx.superAdmin, { view: "perlu-keputusan" }, NOW)).items.map((x) => x.id)).toEqual([d.id]);
    await decideRenewal(fx.superAdmin, d.id, { decision: "CONTINUE", note: null });
    expect(await documentAttentionCount(fx.superAdmin)).toBe(1); // Super Admin juga pengelola → melihat "perlu unggah perpanjangan"
    expect(await documentAttentionCount(fx.hr)).toBe(1);
    expect((await listDocuments(fx.hr, { view: "perlu-perpanjangan" }, NOW)).items[0]).toMatchObject({ id: d.id, needsRenewalUpload: true });
  });

  it("mengunggah kontrak perpanjangan: kontrak lama ditandai diperpanjang, pengingat & lencana berhenti; satu kontrak hanya satu perpanjangan", async () => {
    const old = await createDocument(fx.hr, contract({ endDate: "2027-01-15" }), pdf(), NOW);
    await decideRenewal(fx.superAdmin, old.id, { decision: "CONTINUE", note: null });
    const renewal = await createDocument(fx.hr, contract({ title: "PKWT II", startDate: "2027-01-16", endDate: "2028-01-15", renewsDocumentId: old.id }), pdf("kontrak2.pdf"), NOW);
    const oldNow = await getDocument(fx.hr, old.id);
    expect(oldNow).toMatchObject({ renewedById: renewal.id, needsDecision: false, needsRenewalUpload: false });
    expect(renewal).toMatchObject({ renewsDocumentId: old.id, phase: "ACTIVE" });
    expect(await documentAttentionCount(fx.hr)).toBe(0);
    expect((await fail(createDocument(fx.hr, contract({ title: "PKWT II (ganda)", startDate: "2027-01-16", renewsDocumentId: old.id }), pdf(), NOW)))?.code).toBe("CONFLICT");
    expect((await fail(decideRenewal(fx.superAdmin, old.id, { decision: "DISCONTINUE", note: "Sudah diperpanjang?" })))?.code).toBe("CONFLICT");
    // Kontrak milik karyawan lain tidak boleh "diperpanjang"
    expect((await fail(createDocument(fx.hr, contract({ employeeId: fx.empIds[1], renewsDocumentId: renewal.id, startDate: "2028-01-16", endDate: "2029-01-15" }), pdf(), NOW)))?.fieldErrors?.renewsDocumentId).toBeTruthy();
    // Mengarsipkan perpanjangan yang salah unggah menghidupkan lagi kontrak lama
    await archiveDocument(fx.hr, renewal.id, { reason: "Salah berkas, unggah ulang" });
    expect((await getDocument(fx.hr, old.id)).renewedById).toBeNull();
  });

  it("karyawan nonaktif (berhenti) tidak memicu pengingat; kontrak lama yang sudah berakhir tidak diingatkan", async () => {
    await createDocument(fx.hr, contract({ employeeId: fx.empIds[1] }), pdf(), NOW);
    await prisma.employee.update({ where: { id: fx.empIds[1] }, data: { isActive: false } });
    expect((await runContractReminders(at("2026-12-10"))).sent).toBe(0);
    await createDocument(fx.hr, contract({ employeeId: fx.empIds[2], endDate: "2026-10-01", startDate: "2025-10-02" }), pdf(), NOW);
    expect((await runContractReminders(NOW)).sent).toBe(0);
    expect((await listDocuments(fx.hr, { view: "berakhir" }, NOW)).items).toHaveLength(1);
  });

  it("status berkas di database: kontrak tanpa mulai ditolak constraint; keputusan butuh pelaku", async () => {
    const d = await createDocument(fx.hr, contract(), pdf(), NOW);
    await expect(prisma.$executeRawUnsafe(`UPDATE employee_documents SET "renewalDecision" = 'CONTINUE' WHERE id = '${d.id}'`)).rejects.toThrow(/employee_documents_decision/);
    await expect(prisma.$executeRawUnsafe(`UPDATE employee_documents SET "kind" = 'OTHER' WHERE id = '${d.id}'`)).rejects.toThrow(/tidak dapat diubah/);
  });
});
