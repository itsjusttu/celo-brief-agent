// WEB ONBOARDING (skeleton — Claude Code builds the page).
// Flow for a tester (all in the browser, user's own passkey = admin, non-custodial):
//  1. createPasskeyWallet()  -> user's Altana smart agentic wallet on Celo
//  2. user funds it with a little USDT/CELO from THEIR OWN source (exchange / own wallet / faucet)
//  3. browser generates a session key, calls grantSession({ permissions: {
//        spend: [{ token: USDT, limit: 50_000n /* 0.05 USDT */, period: "day" }] },
//        expiry: now + 14 days, x402Tokens: [USDT], feeToken: USDT })
//  4. browser POSTs { serializedSession, sessionPrivateKey, telegramChatId } to /api/onboard
//     (HTTPS only). Server encrypts the key and stores it.
//  5. Page shows: caps, expiry, Keystore link, and a "Revoke" button (revokeSession).
// Telegram: user opens the bot, sends /start, bot replies with their chat id to paste.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { cfg } from "../lib/config.js";
import { encrypt, upsertUser } from "../lib/store.js";
import type { SerializedSession } from "@altananetwork/sdk";

const app = new Hono();

app.get("/", (c) => c.html("<h1>VN Brief Agent</h1><p>TODO(Claude Code): onboarding UI (Vietnamese + English)</p>"));

app.post("/api/onboard", async (c) => {
  const b = await c.req.json<{
    serializedSession: SerializedSession;
    sessionPrivateKey: string;
    walletAddress: string;
    telegramChatId: string;
    displayName?: string;
  }>();
  if (!b.serializedSession || !b.sessionPrivateKey || !b.walletAddress || !b.telegramChatId)
    return c.json({ error: "missing fields" }, 400);
  const id = randomBytes(4).toString("hex");
  upsertUser({
    id,
    telegramChatId: b.telegramChatId,
    walletAddress: b.walletAddress,
    serializedSession: b.serializedSession,
    encSessionKey: encrypt(b.sessionPrivateKey),
    displayName: b.displayName,
    createdAt: Date.now(),
    runs: [],
  });
  return c.json({ ok: true, id });
});

serve({ fetch: app.fetch, port: cfg.web.port });
console.log(`web on :${cfg.web.port}`);
