import { route } from "@/server/http";
import { listRooms } from "@/server/services/chat/rooms";
export const GET = route(async ({ actor }) => listRooms(actor));
