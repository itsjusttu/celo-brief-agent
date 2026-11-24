import { cfg } from "./config.js";

export async function sendTelegram(chatId: string, text: string) {
  if (!cfg.telegramToken) throw new Error("TELEGRAM_BOT_TOKEN missing");
  const r = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
}
