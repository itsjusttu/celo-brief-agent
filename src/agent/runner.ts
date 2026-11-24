// AGENT: for each onboarded user, restore their Altana session (capped key),
// pay for /brief over x402 FROM THEIR WALLET, send it to their Telegram.
// Run once: npm run agent:once   |   Daily loop: npm run agent
import { createClient, CELO, deserializeSession, signerFromPrivateKey } from "@altananetwork/sdk";
import type { Hex } from "viem";
import { cfg } from "../lib/config.js";
import { loadUsers, saveUsers, decrypt, type UserRecord } from "../lib/store.js";
import { sendTelegram } from "../lib/telegram.js";

// appCode => every execute/session tx carries "altana,<your codes>" (ERC-8021)
const client = createClient({ chains: [CELO], appCode: cfg.appCodes });

async function runFor(u: UserRecord) {
  const session = deserializeSession(u.serializedSession, signerFromPrivateKey(decrypt(u.encSessionKey) as Hex));
  const res = await client.fetchWithX402({
    session,
    url: `${cfg.seller.publicUrl}/brief`,
    chainId: cfg.chainId,
    preferRail: "permit2", // fallback "eip3009" if facilitator/token needs it
  });
  if (res.status !== 200) throw new Error(`brief ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { text: string };
  const receipt = res.headers.get("x-payment-response") ?? res.headers.get("payment-response");
  await sendTelegram(u.telegramChatId, `${body.text}\n\n<i>Paid $${cfg.seller.priceUsd} from your Altana wallet ${u.walletAddress.slice(0, 8)}…</i>`);
  return receipt ?? "";
}

async function tick() {
  const users = loadUsers();
  for (const u of users) {
    try {
      const note = await runFor(u);
      u.runs.push({ at: Date.now(), ok: true, note });
      console.log("ok", u.id);
    } catch (e: any) {
      // spend_limit_exceeded => cap reached; tell user, don't retry
      u.runs.push({ at: Date.now(), ok: false, note: String(e?.message ?? e) });
      console.error("fail", u.id, e?.message ?? e);
    }
    u.lastRunAt = Date.now();
  }
  saveUsers(users);
}

if (process.argv.includes("--once")) {
  await tick();
} else {
  console.log(`agent loop: daily at ${cfg.cronHourUtc}:00 UTC`);
  let lastDay = "";
  setInterval(async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === cfg.cronHourUtc && day !== lastDay) {
      lastDay = day;
      await tick();
    }
  }, 60_000);
}
