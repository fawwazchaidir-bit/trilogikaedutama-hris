import { route } from "@/server/http";
import { listTypes } from "@/server/services/letters/types";
export const GET = route(async ({ actor }) => listTypes(actor));
