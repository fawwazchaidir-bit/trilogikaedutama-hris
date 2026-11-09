import { route } from "@/server/http";
import { getRoom } from "@/server/services/chat/rooms";
export const GET = route<{ id: string }>(async ({ actor, params }) => getRoom(actor, params.id));
