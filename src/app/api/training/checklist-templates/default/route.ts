import { route } from "@/server/http";
import { ensureDefaultTemplate } from "@/server/services/training/work";
export const POST = route(async ({ actor }) => ensureDefaultTemplate(actor));
