import "server-only";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma, transaction } from "../db";
import { Errors } from "../errors";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { isoToDate } from "../json";
import { encryptField } from "../crypto";
import { employeeSchema } from "./employees";
import { parseCsv } from "@/lib/csv";
import { isValidIsoDate } from "@/lib/time";

export const MAX_IMPORT_ROWS = 500;
export type ImportMode = "skip" | "update";

type Field = "employeeNo" | "fullName" | "division" | "position" | "status" | "joinDate" | "phone" | "email" | "address" | "bankName" | "bankAccountNo" | "bankAccountHolder" | "notes";

/** Nama kolom yang dikenali (tanpa membedakan huruf besar/kecil, spasi, dan tanda baca). */
const ALIASES: Record<Field, string[]> = {
  employeeNo: ["noinduk", "nomorinduk", "nik", "nomorindukkaryawan", "employeeno", "idkaryawan"],
  fullName: ["namalengkap", "nama", "fullname", "namakaryawan"],
  division: ["divisi", "division", "departemen"],
  position: ["jabatan", "position", "posisi"],
  status: ["status", "statuskaryawan", "statuskepegawaian"],
  joinDate: ["mulaibekerja", "tanggalmulai", "tanggalmulaibekerja", "joindate", "tglmasuk", "tanggalmasuk"],
  phone: ["telepon", "telp", "nohp", "nomortelepon", "hp", "phone"],
  email: ["email", "surel"],
  address: ["alamat", "address"],
  bankName: ["bank", "namabank"],
  bankAccountNo: ["rekening", "norekening", "nomorrekening", "accountno"],
  bankAccountHolder: ["pemilikrekening", "namapemilikrekening", "atasnama", "pemilik"],
  notes: ["catatan", "keterangan", "notes"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export const IMPORT_TEMPLATE_HEADERS = ["No. Induk", "Nama Lengkap", "Divisi", "Jabatan", "Status", "Mulai Bekerja", "Telepon", "Email", "Alamat", "Bank", "Nomor Rekening", "Pemilik Rekening", "Catatan"];
export const IMPORT_TEMPLATE_ROWS = [
  ["DEMO-101", "Contoh Satu (fiktif)", "Operasional", "Staf Administrasi", "Tetap", "2026-01-05", "0812-0000-0001", "contoh1@contoh.test", "Jl. Contoh No. 1", "Bank Contoh", "1234567890", "Contoh Satu", ""],
  ["DEMO-102", "Contoh Dua (fiktif)", "Pemasaran", "Staf Pemasaran", "Kontrak", "05/02/2026", "0812-0000-0002", "contoh2@contoh.test", "Jl. Contoh No. 2", "", "", "", "Hapus dua baris contoh ini sebelum mengunggah"],
];

const STATUS_MAP: Record<string, "PERMANENT" | "CONTRACT" | "INTERN"> = {
  tetap: "PERMANENT", permanent: "PERMANENT", kontrak: "CONTRACT", contract: "CONTRACT", pkwt: "CONTRACT", magang: "INTERN", intern: "INTERN", internship: "INTERN",
};

/** Tanggal: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, atau sel tanggal Excel. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (isValidIsoDate(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  return null;
}

async function readRows(bytes: Uint8Array, filename: string): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(new TextDecoder("utf-8").decode(bytes));
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer); } catch { throw Errors.validation("File Excel tidak dapat dibaca. Gunakan format .xlsx atau CSV."); }
    const ws = wb.worksheets[0];
    if (!ws) throw Errors.validation("File Excel kosong.");
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= Math.max(row.cellCount, 13); c++) {
        const v = row.getCell(c).value;
        if (v === null || v === undefined) cells.push("");
        else if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
        else if (typeof v === "object") cells.push("text" in v ? String((v as { text: unknown }).text) : "result" in v ? String((v as { result: unknown }).result ?? "") : "richText" in v ? (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("") : "");
        else cells.push(String(v));
      }
      rows.push(cells);
    });
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }
  throw Errors.validation("Format file tidak didukung. Gunakan .xlsx atau .csv.");
}

export interface ImportRowResult {
  line: number;
  employeeNo: string;
  fullName: string;
  action: "create" | "update" | "skip" | "error";
  errors: string[];
  note?: string;
}

export interface ImportPreview {
  rows: ImportRowResult[];
  counts: { create: number; update: number; skip: number; error: number };
  newDivisions: string[];
  unknownColumns: string[];
}

interface Parsed {
  line: number;
  data: ReturnType<typeof employeeSchema.parse> | null;
  divisionName: string | null;
  errors: string[];
  employeeNo: string;
  fullName: string;
  present: Set<Field>;
}

async function analyze(actor: Actor, bytes: Uint8Array, filename: string, mode: ImportMode) {
  assertCan(actor, "employee:import");
  const table = await readRows(bytes, filename);
  if (table.length < 2) throw Errors.validation("File tidak berisi data. Baris pertama harus berisi judul kolom.");
  if (table.length - 1 > MAX_IMPORT_ROWS) throw Errors.validation(`Maksimal ${MAX_IMPORT_ROWS} baris per impor.`);
  const header = table[0]!.map(norm);
  const colOf = new Map<Field, number>();
  const unknownColumns: string[] = [];
  header.forEach((h, i) => {
    const f = (Object.keys(ALIASES) as Field[]).find((k) => ALIASES[k].includes(h));
    if (f && !colOf.has(f)) colOf.set(f, i);
    else if (table[0]![i]!.trim()) unknownColumns.push(table[0]![i]!.trim());
  });
  for (const req of ["employeeNo", "fullName", "position", "joinDate"] as Field[]) {
    if (!colOf.has(req)) throw Errors.validation(`Kolom wajib tidak ditemukan: ${IMPORT_TEMPLATE_HEADERS[["employeeNo", "fullName", "division", "position", "status", "joinDate"].indexOf(req)] ?? req}. Gunakan templat impor.`);
  }

  const existing = await prisma.employee.findMany({ select: { id: true, employeeNo: true } });
  const existingByNo = new Map(existing.map((e) => [e.employeeNo.toLowerCase(), e.id]));
  const divisions = await prisma.division.findMany({ select: { id: true, name: true } });
  const divByName = new Map(divisions.map((d) => [d.name.toLowerCase(), d.id]));

  const seen = new Set<string>();
  const parsed: Parsed[] = [];
  for (let r = 1; r < table.length; r++) {
    const get = (f: Field) => (colOf.has(f) ? (table[r]![colOf.get(f)!] ?? "").trim() : "");
    const present = new Set<Field>((Array.from(colOf.keys()).filter((f) => get(f) !== "")));
    const errors: string[] = [];
    const rawStatus = get("status");
    const status = rawStatus ? STATUS_MAP[rawStatus.toLowerCase()] : "PERMANENT";
    if (!status) errors.push(`Status "${rawStatus}" tidak dikenal (Tetap / Kontrak / Magang)`);
    const join = normalizeDate(get("joinDate"));
    if (!join) errors.push(`Tanggal mulai "${get("joinDate")}" tidak valid (gunakan YYYY-MM-DD atau DD/MM/YYYY)`);
    const divisionName = get("division") || null;
    const candidate = {
      employeeNo: get("employeeNo"), fullName: get("fullName"), position: get("position"), employmentStatus: status ?? "PERMANENT", joinDate: join ?? "",
      phone: get("phone"), email: get("email"), address: get("address"), bankName: get("bankName"), bankAccountHolder: get("bankAccountHolder"), notes: get("notes"),
      ...(get("bankAccountNo") ? { bankAccountNo: get("bankAccountNo") } : {}), divisionId: divisionName ? divByName.get(divisionName.toLowerCase()) ?? null : null,
    };
    const v = employeeSchema.safeParse(candidate);
    if (!v.success) for (const i of v.error.issues) if (!(i.path[0] === "joinDate" && !join)) errors.push(i.message);
    const key = candidate.employeeNo.toLowerCase();
    if (key) { if (seen.has(key)) errors.push(`Nomor induk "${candidate.employeeNo}" muncul lebih dari sekali dalam file`); seen.add(key); }
    parsed.push({ line: r + 1, data: v.success && errors.length === 0 ? v.data : null, divisionName, errors, employeeNo: candidate.employeeNo, fullName: candidate.fullName, present });
  }

  const newDivisions = [...new Set(parsed.filter((p) => p.divisionName && !divByName.has(p.divisionName.toLowerCase())).map((p) => p.divisionName!))];
  const rows: ImportRowResult[] = parsed.map((p) => {
    const exists = existingByNo.has(p.employeeNo.toLowerCase());
    if (p.errors.length) return { line: p.line, employeeNo: p.employeeNo, fullName: p.fullName, action: "error", errors: p.errors };
    if (exists && mode === "skip") return { line: p.line, employeeNo: p.employeeNo, fullName: p.fullName, action: "skip", errors: [], note: "Nomor induk sudah ada — dilewati" };
    return { line: p.line, employeeNo: p.employeeNo, fullName: p.fullName, action: exists ? "update" : "create", errors: [], note: exists ? "Data kosong pada file tidak menimpa data lama" : undefined };
  });
  const counts = { create: 0, update: 0, skip: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  return { parsed, rows, counts, newDivisions, unknownColumns, existingByNo, divByName };
}

export async function previewEmployeeImport(actor: Actor, bytes: Uint8Array, filename: string, mode: ImportMode): Promise<ImportPreview> {
  const a = await analyze(actor, bytes, filename, mode);
  return { rows: a.rows, counts: a.counts, newDivisions: a.newDivisions, unknownColumns: a.unknownColumns };
}

/** Komit atomik: bila ada baris bermasalah, TIDAK ada yang disimpan. */
export async function commitEmployeeImport(actor: Actor, bytes: Uint8Array, filename: string, mode: ImportMode): Promise<ImportPreview> {
  const a = await analyze(actor, bytes, filename, mode);
  if (a.counts.error > 0) throw Errors.validation(`Impor dibatalkan: ${a.counts.error} baris bermasalah. Perbaiki file lalu unggah ulang (tidak ada data yang disimpan).`);
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee_import'))`;
    const divId = new Map(a.divByName);
    for (const name of a.newDivisions) {
      const d = await tx.division.create({ data: { name } });
      divId.set(name.toLowerCase(), d.id);
    }
    for (let i = 0; i < a.parsed.length; i++) {
      const p = a.parsed[i]!;
      const row = a.rows[i]!;
      if (row.action === "skip" || !p.data) continue;
      const d = p.data;
      const divisionId = p.divisionName ? divId.get(p.divisionName.toLowerCase()) ?? null : null;
      const bank = d.bankAccountNo ? (() => { const digits = d.bankAccountNo!.replace(/\D/g, ""); return { bankAccountEnc: encryptField(digits), bankAccountLast4: digits.slice(-4) }; })() : {};
      if (row.action === "create") {
        await tx.employee.create({
          data: { employeeNo: d.employeeNo, fullName: d.fullName, divisionId, position: d.position, employmentStatus: d.employmentStatus, joinDate: isoToDate(d.joinDate), phone: d.phone, email: d.email, address: d.address, bankName: d.bankName, bankAccountHolder: d.bankAccountHolder, notes: d.notes, ...bank },
        });
      } else {
        const existingId = a.existingByNo.get(d.employeeNo.toLowerCase())!;
        const has = (f: Field) => p.present.has(f);
        await tx.employee.update({
          where: { id: existingId },
          data: {
            fullName: d.fullName, position: d.position, employmentStatus: d.employmentStatus, joinDate: isoToDate(d.joinDate),
            ...(has("division") ? { divisionId } : {}), ...(has("phone") ? { phone: d.phone } : {}), ...(has("email") ? { email: d.email } : {}),
            ...(has("address") ? { address: d.address } : {}), ...(has("bankName") ? { bankName: d.bankName } : {}),
            ...(has("bankAccountHolder") ? { bankAccountHolder: d.bankAccountHolder } : {}), ...(has("notes") ? { notes: d.notes } : {}), ...bank,
          } satisfies Prisma.EmployeeUncheckedUpdateInput,
        });
      }
    }
    await writeAudit(tx, actor, {
      action: "employee.import", entityType: "Employee", summary: `Impor karyawan (${filename}): ${a.counts.create} baru, ${a.counts.update} diperbarui, ${a.counts.skip} dilewati`,
      after: { ...a.counts, newDivisions: a.newDivisions, mode },
    });
  });
  return { rows: a.rows, counts: a.counts, newDivisions: a.newDivisions, unknownColumns: a.unknownColumns };
}
