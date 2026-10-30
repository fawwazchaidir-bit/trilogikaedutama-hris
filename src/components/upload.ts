import { ApiClientError } from "@/lib/api-client";

/** Unggah berkas (multipart) ke endpoint unggahan; mengembalikan `{ id }`. Galat dinormalisasi seperti `api()`. */
export async function uploadFile(url: string, file: File): Promise<{ id: string; mimeType: string; size: number }> {
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try { res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" }); }
  catch { throw new ApiClientError("Tidak dapat terhubung ke server. Periksa koneksi Anda.", 0, "NETWORK"); }
  const json = (await res.json().catch(() => ({}))) as { data?: { id: string; mimeType: string; size: number }; error?: { message?: string; code?: string } };
  if (!res.ok || !json.data) throw new ApiClientError(json.error?.message ?? "Gagal mengunggah berkas.", res.status, json.error?.code ?? "UNKNOWN");
  return json.data;
}
