import { readBody, route } from "@/server/http";
import { mergeWorkloadDuplicates } from "@/server/services/training/indicator-data";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => mergeWorkloadDuplicates(actor, params.id, await readBody(req)));
