// AGENT: for each onboarded user, restore their Altana session (capped key),
// pay for /brief over x402 FROM THEIR WALLET, send it to their Telegram.
// Run once: npm run agent:once   |   Daily loop: npm run agent
import { createClient, CELO, deserializeSession, signerFromPrivateKey, altanaErrorOf } from "@altananetwork/sdk";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { Hex } from "viem";
import { cfg } from "../lib/config.js";
import { loadUsers, updateUser, decrypt, type UserRecord, type RunLog } from "../lib/store.js";
import { sendTelegram } from "../lib/telegram.js";

// appCode => every Altana tx carries "altana,<our codes>" (ERC-8021).
// agentIdentity: false — user wallets are not agents; don't auto-register them on ERC-8004.
const client = createClient({ chains: [CELO], appCode: cfg.appCodes(), agentIdentity: false });

/** Failures a retry tomorrow won't fix on its own — tell the user once, then stay quiet. */
const USER_MESSAGES: Record<string, string> = {
  session_expired: "⏰ Quyền của agent đã hết hạn. Vào trang onboarding để cấp lại. / The agent's session expired — re-grant it on the onboarding page.",
  insufficient_funds: "💸 Ví Altana của bạn không đủ USDT để trả phí. Nạp thêm để tiếp tục. / Your Altana wallet is out of USDT — top it up to continue.",
  spend_limit_exceeded: "🧢 Đã chạm giới hạn chi tiêu hôm nay. Agent sẽ thử lại vào ngày mai. / Today's spend cap is reached — the agent will try again tomorrow.",
  call_not_permitted: "🔒 Session key không còn hợp lệ (có thể đã bị thu hồi). / The session key is no longer valid (possibly revoked).",
};

class RunError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function runFor(u: UserRecord): Promise<RunLog> {
  if (u.serializedSession.expiry * 1000 <= Date.now()) throw new RunError("session_expired", "session expired");

  const session = deserializeSession(u.serializedSession, signerFromPrivateKey(decrypt(u.encSessionKey) as Hex));
  const res = await client.fetchWithX402({
    session,
    url: `${cfg.seller.publicUrl}/brief`,
    chainId: cfg.chainId,
    // Celo's facilitator offers USDT on the eip3009 rail only; the SDK picks a payable option anyway.
    preferRail: "eip3009",
  });
  if (res.status !== 200) throw new RunError(`http_${res.status}`, `brief ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = (await res.json()) as { text: string };
  const raw = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  let txHash: string | undefined;
  if (raw) {
    try {
      txHash = decodePaymentResponseHeader(raw).transaction || undefined;
    } catch {
      /* receipt unreadable — the payment still went through (status 200) */
    }
  }
  const link = txHash ? ` · <a href="https://celoscan.io/tx/${txHash}">tx</a>` : "";
  await sendTelegram(
    u.telegramChatId,
    `${body.text}\n\n<i>Paid $${cfg.seller.priceUsd} from your Altana wallet ${u.walletAddress.slice(0, 8)}…${link}</i>`,
  );
  return { at: Date.now(), ok: true, txHash };
}

async function tick() {
  for (const u of loadUsers()) {
    let log: RunLog;
    try {
      log = await runFor(u);
      console.log("ok", u.id, log.txHash ?? "(no receipt)");
    } catch (e: any) {
      const code = e instanceof RunError ? e.code : altanaErrorOf(e)?.code ?? "unknown";
      log = { at: Date.now(), ok: false, code, note: String(e?.message ?? e).slice(0, 300) };
      console.error("fail", u.id, code, log.note);
      const msg = USER_MESSAGES[code];
      if (msg && u.pausedCode !== code) await sendTelegram(u.telegramChatId, msg).catch(() => {});
    }
    updateUser(u.id, (x) => {
      x.runs.push(log);
      x.lastRunAt = log.at;
      x.pausedCode = log.ok ? undefined : log.code;
    });
  }
}

if (process.argv.includes("--once")) {
  await tick();
} else {
  console.log(`agent loop: daily at ${cfg.cronHourUtc}:00 UTC`);
  let lastDay = "";
  let running = false;
  setInterval(async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (running || now.getUTCHours() !== cfg.cronHourUtc || day === lastDay) return;
    lastDay = day;
    running = true;
    try {
      await tick();
    } finally {
      running = false;
    }
  }, 60_000);
}
