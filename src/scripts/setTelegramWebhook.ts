// Points the Telegram bot at the deployed webhook. Run once after the first deploy
// (and again if the domain or secret changes):
//   npm run telegram:webhook
// Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and SELLER_PUBLIC_URL in .env (same values as on Vercel).
import { cfg } from "../lib/config.js";

const { token, webhookSecret } = cfg.telegram;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
if (!/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret)) throw new Error("TELEGRAM_WEBHOOK_SECRET must be 16-256 chars of A-Z a-z 0-9 _ -");

const url = `${cfg.publicUrl()}/api/telegram`;
const api = (method: string, body?: object) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json() as Promise<{ ok: boolean; description?: string; result?: any }>);

const set = await api("setWebhook", { url, secret_token: webhookSecret, allowed_updates: ["message"], drop_pending_updates: true });
console.log("setWebhook:", set.ok ? "ok" : set.description);
await api("setMyCommands", { commands: [{ command: "brief", description: "Nhận bản tin ngay / Get the brief now" }] });
const info = await api("getWebhookInfo");
console.log("webhook url:", info.result?.url, "| pending:", info.result?.pending_update_count, "| last error:", info.result?.last_error_message ?? "none");
