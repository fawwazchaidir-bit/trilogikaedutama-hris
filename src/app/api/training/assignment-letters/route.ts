import { queryObject, route } from "@/server/http";
import { searchAssignmentLetters } from "@/server/services/training/operations";
export const GET = route(async ({ req, actor }) => searchAssignmentLetters(actor, queryObject(req).q));
