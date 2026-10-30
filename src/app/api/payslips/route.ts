import { route } from "@/server/http";
import { listMyPayslips } from "@/server/services/payslips";

export const GET = route(async ({ actor }) => listMyPayslips(actor));
