// Integration test: fake Upstash REST + fake x402 seller. No mainnet tx, no money.
// Covers the anti double-charge claims, cron/webhook auth, Telegram linking and onboarding guards.
// The forged-session case does one free eth_call on Celo RPC.  Run: npm test
import http from "node:http";
import { generatePrivateKey } from "viem/accounts";

// ---------- fake Upstash REST ----------
const kv = new Map<string, string>(), sets = new Map<string, Set<string>>(), lists = new Map<string, string[]>();
const exp = new Map<string, number>();
const alive = (k: string) => { const e = exp.get(k); if (e && e < Date.now()) { kv.delete(k); exp.delete(k); } return kv.has(k); };
function run(cmd: string[]): unknown {
  const [c, ...a] = cmd.map(String); const C = c.toUpperCase();
  switch (C) {
    case "SET": {
      const [k, v, ...o] = a; const up = o.map((x) => x.toUpperCase());
      if (up.includes("NX") && alive(k)) return null;
      kv.set(k, v); exp.delete(k);
      const i = up.indexOf("EX"); if (i >= 0) exp.set(k, Date.now() + Number(o[i + 1]) * 1000);
      return "OK";
    }
    case "GET": return alive(a[0]) ? kv.get(a[0]) : null;
    case "GETDEL": { const v = alive(a[0]) ? kv.get(a[0])! : null; kv.delete(a[0]); return v; }
    case "DEL": { let n = 0; for (const k of a) if (kv.delete(k)) n++; return n; }
    case "MGET": return a.map((k) => (alive(k) ? kv.get(k) : null));
    case "SADD": { const s = sets.get(a[0]) ?? new Set(); sets.set(a[0], s); let n = 0; for (const m of a.slice(1)) if (!s.has(m)) { s.add(m); n++; } return n; }
    case "SMEMBERS": return [...(sets.get(a[0]) ?? [])];
    case "LPUSH": { const l = lists.get(a[0]) ?? []; lists.set(a[0], l); l.unshift(...a.slice(1).reverse()); return l.length; }
    case "LTRIM": { const l = lists.get(a[0]) ?? []; lists.set(a[0], l.slice(Number(a[1]), Number(a[2]) + 1)); return "OK"; }
    case "LRANGE": { const l = lists.get(a[0]) ?? []; const e = Number(a[2]); return l.slice(Number(a[1]), e < 0 ? undefined : e + 1); }
    default: throw new Error("fake upstash: unsupported " + C);
  }
}
const upstash = http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)).on("end", () => {
    const j = JSON.parse(body);
    const out = req.url!.startsWith("/multi-exec") || req.url!.startsWith("/pipeline") ? j.map((c: string[]) => ({ result: run(c) })) : { result: run(j) };
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(out));
  });
});

// ---------- fake seller (/brief) ----------
let mode: "ok" | "503" = "503";
let briefCalls = 0;
const seller = http.createServer((req, res) => {
  briefCalls++;
  if (mode === "503") { res.statusCode = 503; return res.end("down"); }
  const receipt = Buffer.from(JSON.stringify({ success: true, transaction: "0x" + "ab".repeat(32), network: "eip155:42220" })).toString("base64");
  res.setHeader("payment-response", receipt); res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ text: "brief!" }));
});

await new Promise<void>((r) => upstash.listen(8079, r));
await new Promise<void>((r) => seller.listen(8078, r));
Object.assign(process.env, {
  UPSTASH_REDIS_REST_URL: "http://localhost:8079", UPSTASH_REDIS_REST_TOKEN: "t",
  SELLER_PUBLIC_URL: "http://localhost:8078", SELLER_PAY_TO: "0x000000000000000000000000000000000000dEaD",
  CRON_SECRET: "test-cron-secret-1234567890", TELEGRAM_WEBHOOK_SECRET: "tg-secret-abcdefghijkl", TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_BOT_USERNAME: "vn_brief_bot",
});

const { signerFromPrivateKey } = await import("@altananetwork/sdk");
const store = await import("../src/lib/store.js");
const { runDailyBatch } = await import("../src/agent/agent.js");
const { createApp } = await import("../src/service.js");
const app = createApp();

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra: unknown = "") => { cond ? pass++ : fail++; console.log(`${cond ? "✅" : "❌"} ${name}`, cond ? "" : extra); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mkUser(id: string, opts: { chat?: string; expired?: boolean }) {
  const key = generatePrivateKey();
  const signer = signerFromPrivateKey(key);
  await store.saveUser({
    id, walletAddress: "0x" + id.padStart(40, "1"),
    serializedSession: {
      walletAddress: ("0x" + id.padStart(40, "1")) as `0x${string}`, publicKey: signer.publicKey,
      permissions: { spend: [{ token: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", limit: "50000", period: "day" }] },
      expiry: Math.floor(Date.now() / 1000) + (opts.expired ? -10 : 86400),
    } as any,
    encSessionKey: store.encrypt(key), telegramChatId: opts.chat, createdAt: Date.now(),
  });
}
const day = store.utcDay();

// --- daily batch: claim lifecycle ---
await mkUser("a1", {});                       // no telegram   -> failed (no_telegram), no payment attempt
await mkUser("b2", { chat: "111", expired: true }); // expired -> failed (session_expired)
await mkUser("c3", { chat: "222" });          // seller 503 -> transient -> claim released
let r = await runDailyBatch({ budgetMs: 60_000, perUserReserveMs: 1000, day });
let claims = await store.getClaims(day, ["a1", "b2", "c3"]);
check("run1 processed 3", r.processed === 3, r);
check("a1 failed no_telegram", claims[0]?.state === "failed" && claims[0]?.code === "no_telegram", claims[0]);
check("b2 failed session_expired", claims[1]?.state === "failed" && claims[1]?.code === "session_expired", claims[1]);
check("c3 transient -> claim released", claims[2] === null, claims[2]);
check("seller hit once (only c3 reached payment)", briefCalls === 1, briefCalls);

mode = "ok";
r = await runDailyBatch({ budgetMs: 60_000, perUserReserveMs: 1000, day });
claims = await store.getClaims(day, ["a1", "b2", "c3"]);
check("run2 retried only c3", r.processed === 1, r);
check("c3 ok with tx hash", claims[2]?.state === "ok" && claims[2]?.txHash === "0x" + "ab".repeat(32), claims[2]);
const runsC = await store.getRuns("c3");
check("c3 run log: newest ok, older transient fail", runsC[0]?.ok === true && runsC[1]?.code === "http_503", runsC);

const before = briefCalls;
r = await runDailyBatch({ budgetMs: 60_000, perUserReserveMs: 1000, day });
check("run3 pays nobody (all claimed today)", r.processed === 0 && briefCalls === before, { r, briefCalls });

// --- concurrency: duplicate cron deliveries racing ---
for (const id of ["d4", "e5", "f6", "g7"]) await mkUser(id, { chat: "3" + id });
const b2 = briefCalls;
const [x, y] = await Promise.all([runDailyBatch({ budgetMs: 60_000, perUserReserveMs: 1000, day }), runDailyBatch({ budgetMs: 60_000, perUserReserveMs: 1000, day })]);
check("parallel runs pay each new user exactly once", x.processed + y.processed === 4 && briefCalls - b2 === 4, { x, y, calls: briefCalls - b2 });

// --- budget: stops starting users, reports remaining ---
for (const id of ["h8", "i9"]) await mkUser(id, { chat: "4" + id });
r = await runDailyBatch({ budgetMs: 1000, perUserReserveMs: 5000, day });
check("tiny budget -> 0 processed, 2 remaining", r.processed === 0 && r.remaining === 2, r);

// --- stale pending is never retried ---
await store.settleClaim(day, "h8", { state: "pending", at: Date.now() - 3600_000 });
r = await runDailyBatch({ budgetMs: 60_000, perUserReserveMs: 1000, day });
const ch8 = (await store.getClaims(day, ["h8"]))[0];
check("stale pending h8 untouched; i9 paid", r.processed === 1 && ch8?.state === "pending", { r, ch8 });

// --- cron route auth + status ---
const req = (path: string, init?: RequestInit) => app.fetch(new Request("http://x" + path, init));
check("cron without auth -> 401", (await req("/api/cron/daily")).status === 401);
check("cron wrong secret -> 401", (await req("/api/cron/daily", { headers: { authorization: "Bearer nope" } })).status === 401);
const auth = { authorization: "Bearer test-cron-secret-1234567890" };
check("cron right secret -> 202", (await req("/api/cron/daily", { headers: auth })).status === 202);
check("cron bad day param -> 400", (await req("/api/cron/daily?day=xx", { headers: auth })).status === 400);
await sleep(500);
const st = (await (await req("/api/cron/status", { headers: auth })).json()) as any;
check("status shows stale_pending=1", st.stale_pending === 1 && st.total === 9, st);

// --- telegram webhook ---
const tg = (text: string, secret = "tg-secret-abcdefghijkl", chat = 999) =>
  req("/api/telegram", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ message: { chat: { id: chat, type: "private" }, text } }) });
check("webhook wrong secret -> 401", (await tg("/start", "bad-secret-xxxxxxxxxxxx")).status === 401);
const code = await store.createLinkCode("a1");
check("webhook /start <code> -> 200", (await tg(`/start ${code}`)).status === 200);
await sleep(300);
check("chat 999 linked to a1", (await store.userIdForChat("999")) === "a1" && (await store.getUser("a1"))?.telegramChatId === "999");
check("link code is one-time", (await store.consumeLinkCode(code)) === null);
const b3 = briefCalls;
await tg("/brief"); await sleep(300); await tg("/brief"); await sleep(300);
check("/brief twice in 10 min -> paid once", briefCalls - b3 === 1, briefCalls - b3);

// --- onboarding guards ---
const ob = (body: object) => req("/api/onboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
check("onboard empty -> 400", (await ob({})).status === 400);
const k = generatePrivateKey(), s = signerFromPrivateKey(k), w = "0x2222222222222222222222222222222222222222";
const fake = { walletAddress: w, publicKey: s.publicKey, permissions: {}, expiry: Math.floor(Date.now() / 1000) + 3600 };
const other = signerFromPrivateKey(generatePrivateKey());
check("onboard key/session mismatch -> 400", (await (await ob({ serializedSession: { ...fake, publicKey: other.publicKey }, sessionPrivateKey: k, walletAddress: w })).json() as any).error === "session key does not match session");
const forged = await ob({ serializedSession: fake, sessionPrivateKey: k, walletAddress: w });
const forgedBody = (await forged.json()) as any;
check("onboard forged session (not granted on Celo) -> 400", forged.status === 400 && forgedBody.error === "session key is not granted on-chain", forgedBody);

console.log(`\n${pass} passed, ${fail} failed`);
upstash.close(); seller.close();
process.exit(fail ? 1 : 0);
