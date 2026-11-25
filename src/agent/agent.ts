// AGENT: restore a user's Altana session (capped key), pay for /brief over x402
// FROM THEIR WALLET, send it to their Telegram.
// Entry points: /api/cron/daily (Vercel Cron), Telegram /brief, src/agent/runner.ts (local CLI).
import { createClient, CELO, deserializeSession, signerFromPrivateKey, altanaErrorOf, type Client } from "@altananetwork/sdk";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { Hex } from "viem";
import { cfg } from "../lib/config.js";
import {
  listUserIds, getUser, saveUser, decrypt, appendRun, claimDaily, settleClaim, releaseClaim, getClaims, utcDay,
  type UserRecord, type RunLog,
} from "../lib/store.js";
import { sendTelegram } from "../lib/telegram.js";

// appCode => every Altana tx carries "altana,<our codes>" (ERC-8021).
// agentIdentity: false — user wallets are not agents; don't auto-register them on ERC-8004.
let _client: Client | undefined;
const client = () => (_client ??= createClient({ chains: [CELO], appCode: cfg.appCodes(), agentIdentity: false }));

/** Failures a retry today won't fix — tell the user once, then stay quiet. */
const USER_MESSAGES: Record<string, string> = {
  session_expired: "⏰ Quyền của agent đã hết hạn. Vào trang onboarding để cấp lại. / The agent's session expired — re-grant it on the onboarding page.",
  insufficient_funds: "💸 Ví Altana của bạn không đủ USDT để trả phí. Nạp thêm để tiếp tục. / Your Altana wallet is out of USDT — top it up to continue.",
  spend_limit_exceeded: "🧢 Đã chạm giới hạn chi tiêu hôm nay. Agent sẽ thử lại vào ngày mai. / Today's spend cap is reached — the agent will try again tomorrow.",
  call_not_permitted: "🔒 Session key không còn hợp lệ (có thể đã bị thu hồi). / The session key is no longer valid (possibly revoked).",
  no_telegram: "",
};
/** Failures that happen before any payment settles and may pass on a re-run. */
const TRANSIENT = new Set(["relay_unreachable", "price_unavailable", "prices_stale", "quote_expired", "http_500", "http_502", "http_503", "http_504", "network"]);

class RunError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type PayResult = { ok: true; txHash?: string } | { ok: false; code: string; note: string };

/**
 * Pays for one brief from the user's wallet and delivers it. Never throws.
 * The payment result is returned BEFORE Telegram delivery can fail, so a paid run is never recorded as unpaid.
 */
export async function payAndDeliver(u: UserRecord): Promise<PayResult> {
  let txHash: string | undefined;
  let text: string;
  try {
    if (!u.telegramChatId) throw new RunError("no_telegram", "Telegram not linked yet");
    if (u.serializedSession.expiry * 1000 <= Date.now()) throw new RunError("session_expired", "session expired");
    const session = deserializeSession(u.serializedSession, signerFromPrivateKey(decrypt(u.encSessionKey) as Hex));
    let res: Response;
    try {
      res = await client().fetchWithX402({
        session,
        url: `${cfg.publicUrl()}/brief`,
        chainId: cfg.chainId,
        // Celo's facilitator offers USDT on the eip3009 rail only; the SDK picks a payable option anyway.
        preferRail: "eip3009",
      });
    } catch (e) {
      const ae = altanaErrorOf(e);
      throw new RunError(ae?.code ?? "network", String((e as Error)?.message ?? e));
    }
    if (res.status !== 200) throw new RunError(`http_${res.status}`, `brief ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const raw = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    if (raw) {
      try {
        txHash = decodePaymentResponseHeader(raw).transaction || undefined;
      } catch {
        /* receipt unreadable — the payment still went through (status 200) */
      }
    }
    text = ((await res.json()) as { text: string }).text;
  } catch (e: any) {
    const code = e instanceof RunError ? e.code : "unknown";
    return { ok: false, code, note: String(e?.message ?? e).slice(0, 300) };
  }

  const link = txHash ? ` · <a href="https://celoscan.io/tx/${txHash}">tx</a>` : "";
  await sendTelegram(
    u.telegramChatId!,
    `${text}\n\n<i>Paid $${cfg.seller.priceUsd} from your Altana wallet ${u.walletAddress.slice(0, 8)}…${link}</i>`,
  ).catch((e) => console.error("telegram send failed (payment was made)", u.id, e?.message));
  return { ok: true, txHash };
}

/** Records the outcome, tells the user once about a persistent failure. */
export async function recordOutcome(u: UserRecord, r: PayResult, scheduled: boolean) {
  const log: RunLog = r.ok
    ? { at: Date.now(), ok: true, scheduled, txHash: r.txHash }
    : { at: Date.now(), ok: false, scheduled, code: r.code, note: r.note };
  await appendRun(u.id, log);
  if (!r.ok) {
    const msg = USER_MESSAGES[r.code];
    if (msg && u.telegramChatId && u.pausedCode !== r.code) await sendTelegram(u.telegramChatId, msg).catch(() => {});
  }
  const pausedCode = r.ok ? undefined : TRANSIENT.has(r.code) ? u.pausedCode : r.code;
  if (pausedCode !== u.pausedCode) await saveUser({ ...u, pausedCode });
  console.log(r.ok ? "ok" : "fail", u.id, r.ok ? r.txHash ?? "(no receipt)" : `${r.code} ${r.note}`);
}

/**
 * One daily pass, bounded by `budgetMs`. Each user is claimed (SET NX) before paying, so
 * overlapping invocations (Vercel may deliver a cron twice) and re-runs never charge twice.
 * Returns how many users are still unclaimed so the caller can continue in a new invocation.
 */
export async function runDailyBatch(opts: { budgetMs: number; perUserReserveMs?: number; day?: string }) {
  const started = Date.now();
  const reserve = opts.perUserReserveMs ?? 60_000;
  const day = opts.day ?? utcDay();
  let processed = 0;
  let remaining = 0;
  const ids = await listUserIds();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (Date.now() - started > opts.budgetMs - reserve) {
      // Out of time: count only users nobody has claimed today (done/failed/in-flight ones aren't "left").
      const rest = ids.slice(i);
      remaining = (await getClaims(day, rest)).filter((s) => s === null).length;
      break;
    }
    if (!(await claimDaily(day, id))) continue; // already ok / failed / in flight today
    const u = await getUser(id);
    if (!u) {
      await releaseClaim(day, id);
      continue;
    }
    const r = await payAndDeliver(u);
    if (r.ok) await settleClaim(day, id, { state: "ok", at: Date.now(), txHash: r.txHash });
    else if (TRANSIENT.has(r.code)) await releaseClaim(day, id);
    else await settleClaim(day, id, { state: "failed", at: Date.now(), code: r.code });
    await recordOutcome(u, r, true);
    processed++;
  }
  return { day, processed, remaining, ms: Date.now() - started };
}
