// The whole service as one Hono app — runs as Vercel Functions (src/index.ts) or locally (src/dev.ts).
// (Not named src/app.ts: Vercel would try it as the zero-config entry.)
//   /                               onboarding page          (web)
//   /api/onboard                    store a granted session  (web)
//   /brief                          x402-paid brief          (seller)
//   /.well-known/agent-card.json    ERC-8004 agent card      (seller)
//   /api/cron/daily, /api/cron/status   daily agent run      (Vercel Cron, CRON_SECRET)
//   /api/telegram                   Telegram webhook         (TELEGRAM_WEBHOOK_SECRET)
import { Hono } from "hono";
import { createSellerApp } from "./seller/app.js";
import { createWebApp } from "./web/app.js";
import { createCronApp } from "./routes/cron.js";
import { createTelegramApp } from "./routes/telegram.js";

export function createApp() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", createCronApp());
  app.route("/", createTelegramApp());
  app.route("/", createSellerApp());
  app.route("/", createWebApp());
  app.onError((e, c) => {
    console.error("unhandled", e);
    return c.json({ error: "internal error" }, 500);
  });
  return app;
}
