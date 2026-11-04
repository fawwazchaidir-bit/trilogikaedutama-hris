import { route } from "@/server/http";
import { resetIndicatorConfig } from "@/server/services/training/indicator-config";
export const POST = route(async ({ actor }) => resetIndicatorConfig(actor));
