import { route } from "@/server/http";
import { listWorkloadTemplateEntries } from "@/server/services/training/indicator-data";
export const GET = route<{ id: string }>(async ({ actor, params }) => listWorkloadTemplateEntries(actor, params.id));
