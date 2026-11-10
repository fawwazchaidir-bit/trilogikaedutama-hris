import { route } from "@/server/http";
import { auditSettlementDuplicates } from "@/server/services/final-settlements";

/** Audit BACA-SAJA: penyelesaian akhir lama yang terduga memuat hitungan ganda (baris manual tanpa tautan sumber di samping baris sistem). Pimpinan (payroll:approve). */
export const GET = route(async ({ actor }) => auditSettlementDuplicates(actor));
