import { route } from "@/server/http";
import { revealBankAccount } from "@/server/services/employees";

export const POST = route<{ id: string }>(async ({ actor, params }) => revealBankAccount(actor, params.id));
