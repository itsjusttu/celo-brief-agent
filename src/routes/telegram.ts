// Telegram webhook: POST /api/telegram
//   /start <code>  -> links this chat to the user who just onboarded (deep link from the web page)
//   /start         -> explains how to sign up
//   /brief         -> on-demand paid brief (still within the on-chain cap; max 1 per 10 min)
// Telegram retries any non-2xx answer, so we verify the secret, answer 200 at once and do the
// slow part (x402 payment) in the background.
import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { cfg } from "../lib/config.js";
import { background } from "../lib/background.js";
import { sendTelegram } from "../lib/telegram.js";
import { consumeLinkCode, getUser, saveUser, userIdForChat, claimOnDemand } from "../lib/store.js";
import { payAndDeliver, recordOutcome } from "../agent/agent.js";

type Update = { message?: { chat: { id: number; type: string }; text?: string } };

function authorized(header: string | undefined): boolean {
  const want = cfg.telegram.webhookSecret;
  if (!want) return false;
  const a = Buffer.from(header ?? ""), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createTelegramApp() {
  const app = new Hono();

  app.post("/api/telegram", async (c) => {
    if (!authorized(c.req.header("x-telegram-bot-api-secret-token"))) return c.json({ error: "unauthorized" }, 401);
    const update = await c.req.json<Update>().catch(() => ({}) as Update);
    const msg = update.message;
    if (!msg?.text || msg.chat.type !== "private") return c.json({ ok: true }); // ignore groups / non-text
    const chatId = String(msg.chat.id);
    const [cmd, arg] = msg.text.trim().split(/\s+/, 2);
    const onboarding = `${cfg.publicUrl()}/`;

    background(`telegram ${cmd}`, async () => {
      if (cmd === "/start") {
        if (arg && /^[A-Za-z0-9_-]{8,64}$/.test(arg)) {
          const id = await consumeLinkCode(arg);
          const u = id ? await getUser(id) : null;
          if (!u) return sendTelegram(chatId, `Link hết hạn hoặc không hợp lệ. Mở lại trang: ${onboarding}\nThis link expired — open the page again.`);
          await saveUser({ ...u, telegramChatId: chatId });
          return sendTelegram(chatId, "✅ Đã kết nối! Bản tin sẽ đến lúc ~8h sáng (giờ VN) mỗi ngày. Gõ /brief để nhận ngay.\nConnected! Your brief arrives every morning. Send /brief to get one now.");
        }
        return sendTelegram(chatId, `👋 Đăng ký tại / Sign up at: ${onboarding}`);
      }
      if (cmd === "/brief") {
        const id = await userIdForChat(chatId);
        const u = id ? await getUser(id) : null;
        if (!u) return sendTelegram(chatId, `Bạn chưa đăng ký. / Not signed up yet: ${onboarding}`);
        if (!(await claimOnDemand(u.id))) return sendTelegram(chatId, "⏳ Vừa gửi bản tin rồi, thử lại sau 10 phút. / Please wait 10 minutes between briefs.");
        const r = await payAndDeliver(u);
        await recordOutcome(u, r, false);
        if (!r.ok && r.code !== "no_telegram") await sendTelegram(chatId, `⚠️ Không lấy được bản tin (${r.code}). / Couldn't fetch the brief (${r.code}).`).catch(() => {});
        return;
      }
      return sendTelegram(chatId, "Lệnh / Commands: /brief");
    });
    return c.json({ ok: true });
  });

  return app;
}
