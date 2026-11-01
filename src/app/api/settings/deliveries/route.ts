import { readBody, route } from "@/server/http";
import { getDeliveryStats, retryFailedDeliveries, runDeliveriesNow } from "@/server/services/delivery-admin";

export const GET = route(async ({ actor }) => getDeliveryStats(actor));

/** { action: "run" | "retry" } */
export const POST = route(async ({ req, actor }) => {
  const b = (await readBody(req)) as { action?: string };
  return b.action === "retry" ? retryFailedDeliveries(actor) : runDeliveriesNow(actor);
});
