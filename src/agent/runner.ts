// Local CLI: run today's daily pass to completion (same claims as the cron, so it can't double-charge).
//   npm run agent:once
import { runDailyBatch } from "./agent.js";

for (;;) {
  const r = await runDailyBatch({ budgetMs: 10 * 60_000 });
  console.log(`day=${r.day} processed=${r.processed} remaining=${r.remaining} ${r.ms}ms`);
  if (r.remaining === 0) break;
}
