// Vercel Cron: GET /api/cron/daily at 01:00 UTC (Hobby fires anywhere in 01:00–01:59).
//
// Time limit: a Hobby function lives at most 300 s. So each invocation:
//   1. answers 202 right away and does the work in waitUntil (the cron caller never times out),
//   2. pays users one by one and stops starting new ones before ~240 s,
//   3. if users are left, calls itself again (hop+1) for a fresh 300 s budget.
// Every user is claimed in Redis before paying, so hops, duplicate cron deliveries and
// manual re-runs (same URL + secret) never charge anyone twice. Re-running is always safe.
import { Hono, type Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import { cfg } from "../lib/config.js";
import { background } from "../lib/background.js";
import { runDailyBatch } from "../agent/agent.js";
import { listUserIds, getClaims, utcDay } from "../lib/store.js";

const BUDGET_MS = 240_000;    // leave headroom under the 300 s Hobby limit
const PER_USER_RESERVE = 60_000;
const MAX_HOPS = 20;
const STALE_MS = 10 * 60_000;

function authorized(c: Context): boolean {
  const want = `Bearer ${cfg.cronSecret}`;
  const got = c.req.header("authorization") ?? "";
  if (!cfg.cronSecret || cfg.cronSecret.length < 16) return false; // refuse when unset/weak
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCronApp() {
  const app = new Hono();

  app.get("/api/cron/daily", (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const hop = Number(c.req.query("hop") ?? "0");
    const day = c.req.query("day") ?? utcDay(); // continuation hops keep the day they started on
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(hop >= 0 && hop <= MAX_HOPS)) return c.json({ error: "bad params" }, 400);

    background(`cron hop ${hop}`, async () => {
      const r = await runDailyBatch({ budgetMs: BUDGET_MS, perUserReserveMs: PER_USER_RESERVE, day });
      console.log(`[cron] day=${r.day} hop=${hop} processed=${r.processed} remaining=${r.remaining} ${r.ms}ms`);
      if (r.remaining > 0 && hop < MAX_HOPS) {
        // Wait only for the 202 of the next hop; it does its own work in its own invocation.
        const next = await fetch(`${cfg.publicUrl()}/api/cron/daily?hop=${hop + 1}&day=${day}`, {
          headers: { authorization: `Bearer ${cfg.cronSecret}` },
        });
        console.log(`[cron] continued -> hop ${hop + 1}: ${next.status}`);
      }
    });
    return c.json({ accepted: true, day, hop }, 202);
  });

  // Per-user state for a day — what ran, what's left, and stale "pending" claims that need a human
  // (the function died mid-payment: check the wallet on celoscan before clearing the claim in Upstash).
  app.get("/api/cron/status", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const day = c.req.query("day") ?? utcDay();
    const ids = await listUserIds();
    const claims = await getClaims(day, ids);
    const users = ids.map((id, i) => {
      const s = claims[i];
      const stale = s?.state === "pending" && Date.now() - s.at > STALE_MS;
      return { id, state: s ? (stale ? "stale_pending" : s.state) : "not_run", txHash: s?.txHash, code: s?.code };
    });
    const count = (k: string) => users.filter((u) => u.state === k).length;
    return c.json({
      day,
      total: ids.length,
      ok: count("ok"), failed: count("failed"), pending: count("pending"), stale_pending: count("stale_pending"), not_run: count("not_run"),
      users,
    });
  });

  return app;
}
