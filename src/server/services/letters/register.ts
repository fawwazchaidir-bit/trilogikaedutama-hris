import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { env } from "../../env";
import { Errors } from "../../errors";
import type { Actor } from "../../actor";
import { parseInput } from "../../validate";
import { writeAudit } from "../../audit";
import { displayStatus, followUpAlert, isWon, PIPELINE, SENT_OR_DECIDED, STATUS_LABEL, type DisplayStatus } from "@/lib/documents/commercial";
import { todayIso } from "@/lib/time";
import type { Paged } from "@/lib/types";
import { isDirector, personFacts, requireLetters } from "./access";
import { getLetterSettings } from "./frame";

/**
 * Register & dasbor mengikuti Register Surat Excel. Akses: Direktur melihat semua surat bernomor; Manajer (tingkat jabatan) melihat jenis corong penjualan saja;
 * selain itu tidak ada akses (karyawan melihat suratnya sendiri di daftar Persuratan).
 */
async function scopeWhere(actor: Actor): Promise<Prisma.LetterDocumentWhereInput> {
  requireLetters(actor);
  if (isDirector(actor)) return {};
  const f = await personFacts(actor.userId);
  if (f && f.jobLevel === "MANAGER" && f.isActive && !f.isIntern) return { type: { funnel: true, confidential: false } };
  throw Errors.forbidden("Register dan dasbor hanya untuk Direktur dan Manajer.");
}
export async function canViewRegister(actor: Actor): Promise<boolean> {
  try { await scopeWhere(actor); return true; } catch { return false; }
}

const yearRange = (year: number) => ({ gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) });
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const num = (v: bigint | null) => (v == null ? null : Number(v));

export interface RegisterRow {
  id: string; seqNo: number | null; date: string | null; typeCode: string; typeName: string; number: string; recipient: string | null; subject: string | null; product: string | null;
  picName: string | null; signerName: string | null; sentAt: string | null; status: DisplayStatus; statusLabel: string; potentialValue: number | null; dealValue: number | null;
  followUpAt: string | null; alert: "TERLAMBAT" | "HARI_INI" | null; note: string | null; funnel: boolean; confidential: boolean; archiveOnly: boolean; hasFile: boolean;
}
const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(), typeId: z.string().uuid().optional(), series: z.enum(["EKS", "INT"]).optional(),
  status: z.string().max(20).optional(), product: z.string().max(120).optional(), picId: z.string().uuid().optional(), q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

async function names(ids: (string | null)[]): Promise<Map<string, string>> {
  const set = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = await prisma.user.findMany({ where: { id: { in: set } }, select: { id: true, name: true, employee: { select: { fullName: true } } } });
  return new Map(rows.map((r) => [r.id, r.employee?.fullName ?? r.name]));
}

async function loadRows(actor: Actor, q: z.infer<typeof querySchema>): Promise<RegisterRow[]> {
  const base = await scopeWhere(actor);
  const year = q.year ?? Number(todayIso(env().APP_TIMEZONE).slice(0, 4));
  const where: Prisma.LetterDocumentWhereInput = {
    AND: [base, { number: { not: null }, issueDate: yearRange(year) }, ...(q.typeId ? [{ typeId: q.typeId }] : []), ...(q.series ? [{ series: q.series }] : []),
      ...(q.product ? [{ product: q.product }] : []), ...(q.picId ? [{ picId: q.picId }] : []),
      ...(q.q?.trim() ? [{ OR: [{ subject: { contains: q.q.trim(), mode: "insensitive" as const } }, { number: { contains: q.q.trim(), mode: "insensitive" as const } }, { clientName: { contains: q.q.trim(), mode: "insensitive" as const } }] }] : [])],
  };
  const docs = await prisma.letterDocument.findMany({ where, include: { type: { select: { code: true, name: true, series: true, funnel: true, confidential: true } } }, orderBy: [{ issueDate: "asc" }, { seqNo: "asc" }] });
  const n = await names(docs.flatMap((d) => [d.picId, d.signerId]));
  const today = todayIso(env().APP_TIMEZONE);
  const rows = docs.map((d): RegisterRow => {
    const st = displayStatus({ letterStatus: d.status, commercialStatus: d.commercialStatus });
    const conf = d.type.confidential;
    return {
      id: d.id, seqNo: d.seqNo, date: iso(d.issueDate), typeCode: `${d.series}-${String(d.type.code).padStart(3, "0")}`, typeName: d.type.name, number: d.number!,
      recipient: d.clientName ?? d.recipientLines[0] ?? null, subject: conf ? null : d.subject || null, product: d.product, picName: d.picId ? n.get(d.picId) ?? null : null,
      signerName: d.signerId ? n.get(d.signerId) ?? null : null, sentAt: iso(d.sentAt), status: st, statusLabel: STATUS_LABEL[st], potentialValue: num(d.potentialValue), dealValue: num(d.dealValue),
      followUpAt: iso(d.followUpAt), alert: followUpAlert(st, iso(d.followUpAt), today), note: conf ? null : d.commercialNote, funnel: d.type.funnel, confidential: conf, archiveOnly: d.archiveOnly, hasFile: !!d.pdfFileId,
    };
  });
  return q.status ? rows.filter((r) => r.status === q.status) : rows;
}

export async function listRegister(actor: Actor, raw: unknown): Promise<Paged<RegisterRow>> {
  const q = parseInput(querySchema, raw ?? {});
  const rows = await loadRows(actor, q);
  const pageSize = q.pageSize ?? 50; const page = q.page ?? 1;
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, pageCount: Math.max(1, Math.ceil(rows.length / pageSize)) };
}

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
/** Ekspor CSV register (kolom mengikuti sheet Register Excel). Dicatat di Audit Log. */
export async function exportRegisterCsv(actor: Actor, raw: unknown): Promise<string> {
  const q = parseInput(querySchema, raw ?? {});
  const rows = await loadRows(actor, q);
  await writeAudit(prisma, actor, { action: "letter.register_export", entityType: "LetterDocument", summary: `Register surat tahun ${q.year ?? "berjalan"} diekspor (${rows.length} baris)` });
  const head = ["No. Urut", "Tanggal Surat", "Jenis Surat", "Kode", "Nomor Surat", "Tujuan / Instansi", "Perihal", "Produk", "PIC", "Penanda Tangan", "Tanggal Kirim", "Status", "Nilai Potensi (Rp)", "Nilai Deal (Rp)", "Jadwal Follow-up", "Alert FU", "Catatan", "Corong Penjualan", "Sifat"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) lines.push([r.seqNo, r.date, r.typeName, r.typeCode, r.number, r.recipient, r.subject, r.product, r.picName, r.signerName, r.sentAt, r.statusLabel, r.potentialValue, r.dealValue, r.followUpAt, r.alert === "TERLAMBAT" ? "TERLAMBAT" : "", r.note, r.funnel ? "Ya" : "Tidak", r.confidential ? "Rahasia" : "Biasa"].map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export interface FunnelDashboard {
  year: number; target: number;
  summary: { issued: number; cancelled: number; offersSent: number; pipeline: number; deal: number; rejected: number; conversion: number; winRate: number; pipelineValue: number; dealValue: number; targetAchievement: number; overdueFollowUp: number };
  perType: { code: string; name: string; count: number; deal: number; potential: number; dealValue: number }[];
  perStatus: { status: DisplayStatus; label: string; count: number; potential: number }[];
  perProduct: { product: string; count: number; offersSent: number; deal: number; dealValue: number }[];
  perPic: { pic: string; offers: number; deal: number; dealValue: number; pipelineValue: number }[];
  perMonth: { month: number; issued: number; offersSent: number; deal: number; dealValue: number }[];
}
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Dasbor surat & penjualan (Excel 1:1 + per PIC & per bulan). Dihitung dari data; tidak ada angka manual. */
export async function funnelDashboard(actor: Actor, raw: unknown): Promise<FunnelDashboard> {
  const q = parseInput(z.object({ year: z.coerce.number().int().min(2020).max(2100).optional() }), raw ?? {});
  const year = q.year ?? Number(todayIso(env().APP_TIMEZONE).slice(0, 4));
  const [rows, settings, types] = await Promise.all([loadRows(actor, { year, pageSize: 200 }), getLetterSettings(), prisma.letterType.findMany({ orderBy: [{ series: "asc" }, { code: "asc" }], select: { series: true, code: true, name: true, funnel: true } })]);
  const f = rows.filter((r) => r.funnel);
  const sentOrDecided = f.filter((r) => SENT_OR_DECIDED.includes(r.status));
  const won = f.filter((r) => isWon(r.status, r.dealValue));
  const rejected = f.filter((r) => r.status === "REJECTED");
  const pipeline = f.filter((r) => PIPELINE.includes(r.status));
  const sum = (a: RegisterRow[], k: "potentialValue" | "dealValue") => a.reduce((s, r) => s + (r[k] ?? 0), 0);
  const dealValue = sum(won, "dealValue");
  const perType = types.map((t) => {
    const code = `${t.series}-${String(t.code).padStart(3, "0")}`; const rs = rows.filter((r) => r.typeCode === code); const w = rs.filter((r) => r.funnel && isWon(r.status, r.dealValue));
    return { code, name: t.name, count: rs.length, deal: w.length, potential: sum(rs.filter((r) => r.funnel), "potentialValue"), dealValue: sum(w, "dealValue") };
  });
  const statuses: DisplayStatus[] = ["DRAFT", "SENT", "FOLLOW_UP", "NEGOTIATION", "DEAL", "REJECTED", "DONE", "CANCELLED"];
  const perStatus = statuses.map((s) => ({ status: s, label: STATUS_LABEL[s], count: rows.filter((r) => (r.funnel ? r.status : r.status === "CANCELLED" ? "CANCELLED" : "DONE") === s).length, potential: sum(rows.filter((r) => r.funnel && r.status === s), "potentialValue") }));
  const products = [...new Set(f.map((r) => r.product ?? "(belum diisi)"))].sort();
  const perProduct = products.map((p) => { const rs = f.filter((r) => (r.product ?? "(belum diisi)") === p); return { product: p, count: rs.length, offersSent: rs.filter((r) => SENT_OR_DECIDED.includes(r.status)).length, deal: rs.filter((r) => isWon(r.status, r.dealValue)).length, dealValue: sum(rs.filter((r) => isWon(r.status, r.dealValue)), "dealValue") }; });
  const pics = [...new Set(f.map((r) => r.picName ?? "(tanpa PIC)"))].sort();
  const perPic = pics.map((p) => { const rs = f.filter((r) => (r.picName ?? "(tanpa PIC)") === p); return { pic: p, offers: rs.filter((r) => SENT_OR_DECIDED.includes(r.status)).length, deal: rs.filter((r) => isWon(r.status, r.dealValue)).length, dealValue: sum(rs.filter((r) => isWon(r.status, r.dealValue)), "dealValue"), pipelineValue: sum(rs.filter((r) => PIPELINE.includes(r.status)), "potentialValue") }; });
  const perMonth = Array.from({ length: 12 }, (_, i) => { const m = i + 1; const rs = rows.filter((r) => r.date && Number(r.date.slice(5, 7)) === m); const fs = rs.filter((r) => r.funnel); return { month: m, issued: rs.length, offersSent: fs.filter((r) => SENT_OR_DECIDED.includes(r.status)).length, deal: fs.filter((r) => isWon(r.status, r.dealValue)).length, dealValue: sum(fs.filter((r) => isWon(r.status, r.dealValue)), "dealValue") }; });
  const target = Number(settings.annualTarget);
  return {
    year, target,
    summary: {
      issued: rows.length, cancelled: rows.filter((r) => r.status === "CANCELLED").length, offersSent: sentOrDecided.length, pipeline: pipeline.length, deal: won.length, rejected: rejected.length,
      conversion: ratio(won.length, sentOrDecided.length), winRate: ratio(won.length, won.length + rejected.length), pipelineValue: sum(pipeline, "potentialValue"), dealValue,
      targetAchievement: ratio(dealValue, target), overdueFollowUp: f.filter((r) => r.alert === "TERLAMBAT").length,
    },
    perType, perStatus, perProduct, perPic, perMonth,
  };
}
