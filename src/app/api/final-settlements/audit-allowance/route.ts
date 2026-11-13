import { route } from "@/server/http";
import { auditAllowanceOverlaps } from "@/server/services/final-settlements";

/** Audit BACA-SAJA: uang harian pada penyelesaian akhir yang berlaku yang bermasalah — sudah punya Bukti Penerimaan aktif (`ACTIVE_RECEIPT`) atau surat tugasnya dibatalkan (`LETTER_CANCELLED`). Pimpinan (payroll:approve). */
export const GET = route(async ({ actor }) => auditAllowanceOverlaps(actor));
