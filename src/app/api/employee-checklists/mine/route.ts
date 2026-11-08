import { route } from "@/server/http";
import { listMyChecklistItems } from "@/server/services/employee-checklists";

/** Butir checklist yang menjadi tanggung jawab saya dan belum selesai. */
export const GET = route(async ({ actor }) => listMyChecklistItems(actor));
