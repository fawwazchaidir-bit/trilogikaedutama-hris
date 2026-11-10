import { route } from "@/server/http";
import { applyDivisionSuggestions } from "@/server/services/letters/types";
/** Terapkan usulan divisi penandatangan dari Register Excel (Direktur). */
export const POST = route(async ({ actor }) => applyDivisionSuggestions(actor));
