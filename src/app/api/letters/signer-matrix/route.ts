import { route } from "@/server/http";
import { signerMatrix } from "@/server/services/letters/types";
/** Bagan hak tanda tangan (Direktur): pemegang wewenang per jenis surat. */
export const GET = route(async ({ actor }) => signerMatrix(actor));
