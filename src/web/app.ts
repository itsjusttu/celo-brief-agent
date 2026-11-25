// WEB ONBOARDING (the page itself is Bước 4).
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
//  4. browser POSTs { serializedSession, sessionPrivateKey, walletAddress } to /api/onboard.
//     Server checks the key is really granted ON-CHAIN, encrypts it and stores it.
//  5. Page shows a Telegram deep link t.me/<bot>?start=<code>; the bot binds the chat (no copy/paste of chat ids).
//  6. Page shows: caps, expiry, Keystore link, and a "Revoke" button (revokeSession).
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, isAddress, isAddressEqual, type Hex } from "viem";
import { deserializeSession, signerFromPrivateKey, keyHashForSessionOrKey, accountHasKey, type SerializedSession } from "@altananetwork/sdk";
import { cfg } from "../lib/config.js";
import { encrypt, saveUser, getUser, userIdForWallet, createLinkCode } from "../lib/store.js";

// No `chain`: viem's celo chain adds Celo-specific tx formatters whose types the SDK's
// generic PublicClient doesn't accept. accountHasKey only does an eth_call on Celo's RPC.
const pub = createPublicClient({ transport: http(cfg.rpc) });

export function createWebApp() {
  const app = new Hono();

  app.get("/", (c) => c.html("<h1>VN Brief Agent</h1><p>TODO(Bước 4): onboarding UI (Vietnamese + English)</p>"));

  app.post("/api/onboard", async (c) => {
    const b = await c.req
      .json<{ serializedSession: SerializedSession; sessionPrivateKey: string; walletAddress: string; displayName?: string }>()
      .catch(() => null);
    if (!b?.serializedSession || !b.sessionPrivateKey || !b.walletAddress) return c.json({ error: "missing fields" }, 400);
    if (!/^0x[0-9a-fA-F]{64}$/.test(b.sessionPrivateKey)) return c.json({ error: "bad session key" }, 400);
    if (!isAddress(b.walletAddress) || !isAddressEqual(b.walletAddress, b.serializedSession.walletAddress))
      return c.json({ error: "wallet does not match session" }, 400);
    if (!(b.serializedSession.expiry * 1000 > Date.now())) return c.json({ error: "session already expired" }, 400);

    let keyHash: Hex;
    try {
      // throws if the key does not match the session's public key
      const session = deserializeSession(b.serializedSession, signerFromPrivateKey(b.sessionPrivateKey as Hex));
      keyHash = keyHashForSessionOrKey(session);
    } catch {
      return c.json({ error: "session key does not match session" }, 400);
    }
    // The wallet itself must hold this key on Celo — i.e. its passkey owner granted it.
    // Without this, anyone could post a made-up session for someone else's wallet.
    try {
      if (!(await accountHasKey(pub, b.walletAddress, keyHash))) return c.json({ error: "session key is not granted on-chain" }, 400);
    } catch {
      return c.json({ error: "could not reach Celo RPC, try again" }, 503);
    }

    // One record per wallet: re-onboarding (new grant) keeps the id and the linked Telegram chat.
    const existingId = await userIdForWallet(b.walletAddress);
    const existing = existingId ? await getUser(existingId) : null;
    const id = existing?.id ?? randomBytes(4).toString("hex");
    await saveUser({
      id,
      walletAddress: b.walletAddress,
      serializedSession: b.serializedSession,
      encSessionKey: encrypt(b.sessionPrivateKey),
      telegramChatId: existing?.telegramChatId,
      displayName: b.displayName?.slice(0, 64) ?? existing?.displayName,
      createdAt: existing?.createdAt ?? Date.now(),
    });
    const code = await createLinkCode(id);
    const telegramLink = cfg.telegram.botUsername ? `https://t.me/${cfg.telegram.botUsername}?start=${code}` : null;
    return c.json({ ok: true, id, telegramLinked: !!existing?.telegramChatId, telegramLink });
  });

  return app;
}
