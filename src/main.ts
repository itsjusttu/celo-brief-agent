// PRODUCTION ENTRY (Railway): one process, one domain, one volume.
//   - onboarding web  (/ and /api/onboard)
//   - x402 seller     (/brief, /.well-known/agent-card.json)
//   - daily agent     (in-process loop; set RUN_AGENT=false to disable)
// One domain matters: passkeys are bound to it (rpId) and the ERC-8004 agentURI points at it.
// One process matters: web and agent share data/users.json on the same volume. Keep replicas = 1.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createSellerApp } from "./seller/app.js";
import { createWebApp } from "./web/app.js";
import { startDailyLoop } from "./agent/agent.js";
import { cfg } from "./lib/config.js";

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/", createSellerApp());
app.route("/", createWebApp());

const port = Number(process.env.PORT || cfg.web.port);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`main on :${port}  public ${cfg.seller.publicUrl}`);

if (process.env.RUN_AGENT !== "false") startDailyLoop();
