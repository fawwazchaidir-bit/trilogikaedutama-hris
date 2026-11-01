import { route } from "@/server/http";
import { getAccount } from "@/server/services/account";

export const GET = route(async ({ actor }) => getAccount(actor), { allowMustChange: true });
