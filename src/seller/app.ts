// x402 SELLER: GET /brief costs BRIEF_PRICE_USD in USDT on Celo mainnet.
// Settlement through Celo's hosted facilitator (api.x402.celo.org, needs X-API-Key).
// Register SELLER_PAY_TO on the Loops entry — x402 payments don't carry ERC-8021 tags.
//
// Price MUST be an explicit asset object: on Celo, `price: "$0.01"` silently
// resolves to USDC, not USDT (x402.celo.org/skill.md).
import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { parseUnits } from "viem";
import { cfg, TOKENS } from "../lib/config.js";
import { buildBrief } from "./brief.js";

const NETWORK = "eip155:42220" as const;

export function createSellerApp() {
  if (!cfg.seller.payTo) throw new Error("SELLER_PAY_TO missing or not a valid address");
  if (!cfg.seller.publicUrl) throw new Error("SELLER_PUBLIC_URL missing");
  if (!cfg.seller.apiKey) console.warn("X402_API_KEY is empty: the facilitator will refuse /settle");

  const facilitator = new HTTPFacilitatorClient({
    url: cfg.seller.facilitator,
    async createAuthHeaders() {
      const h = { "X-API-Key": cfg.seller.apiKey };
      return { verify: h, settle: h, supported: h };
    },
  });
  const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());

  // 0.01 USD -> "10000" base units (USDT has 6 decimals)
  const priceAmount = parseUnits(cfg.seller.priceUsd, TOKENS.USDT.decimals).toString();

  const app = new Hono();

  // ERC-8004 registration file (the agentURI registered on-chain points here).
  // `registrations` is filled in once AGENT_ID is set after register8004.
  app.get("/.well-known/agent-card.json", (c) =>
    c.json({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "VN Brief Agent",
      description:
        "Pays for a daily crypto brief over x402 from the user's Altana smart agentic wallet (capped, revocable session key) and delivers it to Telegram in Vietnamese/English.",
      services: [{ name: "web", endpoint: `${cfg.seller.publicUrl}/brief` }],
      x402Support: true,
      active: true,
      supportedTrust: ["reputation"],
      registrations: process.env.AGENT_ID
        ? [{ agentId: Number(process.env.AGENT_ID), agentRegistry: `eip155:42220:${cfg.identityRegistry}` }]
        : [],
    }),
  );

  app.use(
    "/brief",
    paymentMiddleware(
      {
        "GET /brief": {
          accepts: [
            {
              scheme: "exact",
              network: NETWORK,
              payTo: cfg.seller.payTo,
              price: { amount: priceAmount, asset: TOKENS.USDT.address, extra: { ...TOKENS.USDT.eip712 } },
            },
          ],
          // Behind Railway's proxy the request looks like http://; state the public https URL.
          resource: `${cfg.seller.publicUrl}/brief`,
          description: "Daily VI/EN crypto brief",
          mimeType: "application/json",
        },
      },
      resourceServer,
    ),
  );

  app.get("/brief", async (c) => c.json(await buildBrief()));

  console.log(`seller: /brief costs ${priceAmount} USDT base units, payTo ${cfg.seller.payTo}`);
  return app;
}
