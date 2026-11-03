import { route } from "@/server/http";
import { listDirectory } from "@/server/services/training/access";
export const GET = route(async ({ actor }) => listDirectory(actor));
