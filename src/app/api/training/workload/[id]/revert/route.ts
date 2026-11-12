import { route } from "@/server/http";
import { previewWorkloadRevert, revertWorkloadToTemplate } from "@/server/services/training/indicator-data";
/** GET = pratinjau perubahan (tidak mengubah data); POST = terapkan "Kembalikan ke template". */
export const GET = route<{ id: string }>(async ({ actor, params }) => previewWorkloadRevert(actor, params.id));
export const POST = route<{ id: string }>(async ({ actor, params }) => revertWorkloadToTemplate(actor, params.id));
