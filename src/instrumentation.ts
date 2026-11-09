/** Dipanggil Next.js sekali saat server Node mulai: menyalakan pekerja latar (pengiriman notifikasi, retensi foto absensi, pengingat kontrak kerja, pekerja harian Training & Operations). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDeliveryWorker } = await import("./server/notify/worker");
  startDeliveryWorker();
  const { startRetentionWorker } = await import("./server/retention-worker");
  startRetentionWorker();
  const { startContractWorker } = await import("./server/contract-worker");
  startContractWorker();
  const { startTrainingWorker } = await import("./server/training-worker");
  startTrainingWorker();
  const { startChecklistWorker } = await import("./server/checklist-worker");
  startChecklistWorker();
  const { startChatWorker } = await import("./server/chat-worker");
  startChatWorker();
}
