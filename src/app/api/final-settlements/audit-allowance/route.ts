import { route } from "@/server/http";
import { auditAllowanceOverlaps } from "@/server/services/final-settlements";

/** Audit BACA-SAJA: uang harian yang tercatat dua kali (ada di penyelesaian akhir yang berlaku DAN sudah punya Bukti Penerimaan aktif). Pimpinan (payroll:approve). */
export const GET = route(async ({ actor }) => auditAllowanceOverlaps(actor));
