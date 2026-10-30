import { route } from "@/server/http";
import { getAdminDashboard, getEmployeeDashboard } from "@/server/services/dashboard";
import { can } from "@/lib/permissions";

export const GET = route(async ({ actor }) => (can(actor.role, "dashboard:admin") ? getAdminDashboard(actor) : getEmployeeDashboard(actor)));
