// WEB ONBOARDING (skeleton — the page itself is Bước 4).
// Flow for a tester (all in the browser, user's own passkey = admin, non-custodial):
//  1. createPasskeyWallet({ name: "VN Brief Agent" })  -> user's Altana smart agentic wallet on Celo
//     (createClient({ chains: [CELO], appCode: [...], agentIdentity: false }))
//  2. user funds it with a little USDT/CELO from THEIR OWN source (exchange / own wallet)
//  3. browser generates a session key and calls:
//       grantSession({ wallet, signer: passkeySigner, sessionSigner: signerFromPrivateKey(sessionKey),
//         permissions: {
//           // allowlist — omitting `calls` means ALL targets are allowed. x402 payments are
//           // signatures, not session calls, so the list can stay this tight.
//           calls: [{ to: USDT, signature: "transfer(address,uint256)" }],
//           spend: [{ token: USDT, limit: 50_000n /* 0.05 USDT, 6 decimals */, period: "day" }],
//         },
//         expiry: Math.floor(Date.now() / 1000) + 14 * 86400,   // unix SECONDS
//         x402Tokens: [USDT],   // approves USDT->Permit2 and both as signature checkers
//         feeToken: USDT })
//  4. browser POSTs { serializedSession, sessionPrivateKey, walletAddress, telegramChatId } to /api/onboard
//     (HTTPS only). Server checks it, encrypts the key and stores it.
//  5. Page shows: caps, expiry, Keystore link, and a "Revoke" button (revokeSession).
// Telegram: user opens the bot, sends /start, bot replies with their chat id to paste.
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { isAddress, isAddressEqual, type Hex } from "viem";
import { deserializeSession, signerFromPrivateKey, type SerializedSession } from "@altananetwork/sdk";
import { encrypt, upsertUser } from "../lib/store.js";

export function createWebApp() {
  const app = new Hono();

  app.get("/", (c) => c.html("<h1>VN Brief Agent</h1><p>TODO(Bước 4): onboarding UI (Vietnamese + English)</p>"));

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
    if (!/^0x[0-9a-fA-F]{64}$/.test(b.sessionPrivateKey)) return c.json({ error: "bad session key" }, 400);
    if (!/^-?\d{1,20}$/.test(b.telegramChatId)) return c.json({ error: "bad telegram chat id" }, 400);
    if (!isAddress(b.walletAddress) || !isAddressEqual(b.walletAddress, b.serializedSession.walletAddress))
      return c.json({ error: "wallet does not match session" }, 400);
    if (!(b.serializedSession.expiry * 1000 > Date.now())) return c.json({ error: "session already expired" }, 400);
    try {
      // throws if the key does not match the session's registered public key
      deserializeSession(b.serializedSession, signerFromPrivateKey(b.sessionPrivateKey as Hex));
    } catch {
      return c.json({ error: "session key does not match session" }, 400);
    }
    // TODO(Bước 4): also confirm the key is live on the Altana KeyStore before accepting it.

    const id = randomBytes(4).toString("hex");
    upsertUser({
      id,
      telegramChatId: b.telegramChatId,
      walletAddress: b.walletAddress,
      serializedSession: b.serializedSession,
      encSessionKey: encrypt(b.sessionPrivateKey),
      displayName: b.displayName?.slice(0, 64),
      createdAt: Date.now(),
      runs: [],
    });
    return c.json({ ok: true, id });
  });

  return app;
}
