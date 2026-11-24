// x402 SELLER: GET /brief costs BRIEF_PRICE_USD in USDT on Celo mainnet.
// Settlement through Celo's hosted facilitator (api.x402.celo.org, needs X-API-Key).
// Register SELLER_PAY_TO on the hackathon page — x402 payments don't carry ERC-8021 tags yet.
//
// NOTE(Claude Code): the @x402/hono v2 API below follows the x402.celo.org skill
// (https://x402.celo.org/skill.md). Check exact export names against the installed version
// and fix imports if they differ. Run `npm run check:supported` first to see which
// schemes/assets the facilitator supports on eip155:42220.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { cfg } from "../lib/config.js";
import { buildBrief } from "./brief.js";

const NETWORK = "eip155:42220";

const facilitator = new HTTPFacilitatorClient({
  url: cfg.seller.facilitator,
  async createAuthHeaders() {
    const h = { "X-API-Key": cfg.seller.apiKey };
    return { verify: h, settle: h, supported: h };
  },
});

const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// Agent card for ERC-8004 registration (tokenURI points here)
app.get("/.well-known/agent-card.json", (c) =>
  c.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "VN Brief Agent",
    description:
      "Pays for a daily crypto brief over x402 from the user's Altana smart agentic wallet (capped session key) and delivers it to Telegram in Vietnamese/English.",
    services: [{ name: "x402", endpoint: `${cfg.seller.publicUrl}/brief` }],
    supportedTrust: ["reputation"],
  }),
);

app.use(
  paymentMiddleware(
    {
      "GET /brief": {
        accepts: [{ scheme: "exact", price: `$${cfg.seller.priceUsd}`, network: NETWORK, payTo: cfg.seller.payTo }],
        description: "Daily VI/EN crypto brief",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/brief", async (c) => c.json(await buildBrief()));

serve({ fetch: app.fetch, port: cfg.seller.port });
console.log(`seller on :${cfg.seller.port}  (public: ${cfg.seller.publicUrl})`);
