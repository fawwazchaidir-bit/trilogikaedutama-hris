import { route } from "@/server/http";
import { openChatStream } from "@/server/services/chat/stream";

// Aliran panjang: tidak boleh di-cache atau dirender statis; berjalan di runtime Node.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(async ({ req, actor }) => openChatStream(req, actor));
