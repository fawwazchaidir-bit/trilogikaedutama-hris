import { route } from "@/server/http";
import { listAllDocuments } from "@/server/services/training/operations";
export const GET = route(async ({ actor }) => listAllDocuments(actor));
