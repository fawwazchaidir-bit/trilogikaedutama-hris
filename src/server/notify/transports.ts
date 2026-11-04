import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { emailConfigured, env, pushConfigured, whatsappConfigured } from "../env";
import { sendWebPush, type PushTarget } from "@/lib/webpush";

export interface EmailMessage { to: string; subject: string; text: string }
export interface WhatsappMessage { to: string; text: string }

export interface PushMessage { title: string; body: string; href: string; tag?: string }

export interface Transports {
  email: (m: EmailMessage) => Promise<void>;
  whatsapp: (m: WhatsappMessage) => Promise<void>;
  push: (target: PushTarget, m: PushMessage) => Promise<void>;
}

/** Hanya untuk tes: mengganti pengirim sebenarnya. `null` = kembali ke konfigurasi lingkungan. */
let override: Partial<Transports> | null = null;
export function setTransportsForTest(t: Partial<Transports> | null): void { override = t; }

export const emailAvailable = (): boolean => !!override?.email || emailConfigured();
export const whatsappAvailable = (): boolean => !!override?.whatsapp || whatsappConfigured();
export const pushAvailable = (): boolean => !!override?.push || pushConfigured();

const TIMEOUT_MS = 15_000;

let mailer: Transporter | null = null;
function smtp(): Transporter {
  if (!mailer) {
    const e = env();
    mailer = nodemailer.createTransport({
      host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS ?? "" } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
  }
  return mailer;
}

export async function sendEmail(m: EmailMessage): Promise<void> {
  if (override?.email) return override.email(m);
  if (!emailConfigured()) throw new Error("Email belum dikonfigurasi (SMTP_HOST & MAIL_FROM).");
  await smtp().sendMail({ from: env().MAIL_FROM, to: m.to, subject: m.subject, text: m.text });
}

async function post(url: string, init: { headers: Record<string, string>; body: string }): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { method: "POST", headers: init.headers, body: init.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return { status: res.status, text };
}

/** Permintaan WhatsApp untuk tiap penyedia — dipisah agar dapat diuji tanpa jaringan. */
export function buildWhatsappRequest(m: WhatsappMessage, e: ReturnType<typeof env>): { url: string; headers: Record<string, string>; body: string } {
  switch (e.WHATSAPP_PROVIDER) {
    case "fonnte":
      return {
        url: e.WHATSAPP_API_URL ?? "https://api.fonnte.com/send",
        headers: { Authorization: e.WHATSAPP_TOKEN ?? "", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ target: m.to, message: m.text }).toString(),
      };
    case "cloud_api": {
      const base = (e.WHATSAPP_API_URL ?? "https://graph.facebook.com/v21.0").replace(/\/$/, "");
      const payload = e.WHATSAPP_TEMPLATE_NAME
        ? {
          messaging_product: "whatsapp", to: m.to, type: "template",
          // Parameter template tidak boleh berisi baris baru.
          template: { name: e.WHATSAPP_TEMPLATE_NAME, language: { code: e.WHATSAPP_TEMPLATE_LANG }, components: [{ type: "body", parameters: [{ type: "text", text: m.text.replace(/\s*\n+\s*/g, " · ").slice(0, 1000) }] }] },
        }
        : { messaging_product: "whatsapp", to: m.to, type: "text", text: { preview_url: false, body: m.text } };
      return { url: `${base}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) };
    }
    case "webhook":
      return {
        url: e.WHATSAPP_API_URL ?? "",
        headers: { "Content-Type": "application/json", ...(e.WHATSAPP_TOKEN ? { Authorization: `Bearer ${e.WHATSAPP_TOKEN}` } : {}) },
        body: JSON.stringify({ channel: "whatsapp", to: m.to, text: m.text, app: "trilogika-hris" }),
      };
    default:
      throw new Error("WHATSAPP_PROVIDER belum dikonfigurasi.");
  }
}

export async function sendWhatsapp(m: WhatsappMessage): Promise<void> {
  if (override?.whatsapp) return override.whatsapp(m);
  if (!whatsappConfigured()) throw new Error("WhatsApp belum dikonfigurasi (WHATSAPP_PROVIDER & kredensialnya).");
  const e = env();
  const req = buildWhatsappRequest(m, e);
  const res = await post(req.url, { headers: req.headers, body: req.body });
  if (e.WHATSAPP_PROVIDER === "fonnte") {
    // Fonnte menjawab 200 walau gagal; status sebenarnya ada di JSON.
    let ok = false, reason = "respons tidak dikenali";
    try { const j = JSON.parse(res.text) as { status?: boolean; reason?: string }; ok = j.status === true; reason = j.reason ?? reason; } catch { /* non-JSON */ }
    if (!ok) throw new Error(`Fonnte menolak pesan: ${reason}`);
  }
}

/**
 * Kirim satu notifikasi push desktop. Muatan dienkripsi end-to-end untuk peramban penerima (RFC 8291); push service hanya melihat data terenkripsi.
 * `PushGoneError` = langganan sudah tidak berlaku (pemanggil menghapusnya). Judul/isi dipotong agar muat dan tidak memuat data berlebih.
 */
export async function sendPush(target: PushTarget, m: PushMessage): Promise<void> {
  if (override?.push) return override.push(target, m);
  if (!pushConfigured()) throw new Error("Notifikasi push belum dikonfigurasi (WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT).");
  const e = env();
  await sendWebPush(target, { title: m.title.slice(0, 120), body: m.body.slice(0, 240), href: m.href, ...(m.tag ? { tag: m.tag } : {}) }, { publicKey: e.WEB_PUSH_PUBLIC_KEY!, privateKey: e.WEB_PUSH_PRIVATE_KEY!, subject: e.WEB_PUSH_SUBJECT! });
}
