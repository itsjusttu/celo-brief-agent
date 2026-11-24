import "dotenv/config";
import type { Address, Hex } from "viem";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see .env.example)`);
  return v;
}
const opt = (name: string, d = "") => process.env[name] ?? d;

export const cfg = {
  rpc: opt("CELO_RPC", "https://forno.celo.org"),
  chainId: Number(opt("CHAIN_ID", "42220")),
  appCodes: [opt("APP_CODE", "vn_brief_agent"), opt("CELO_ASSIGNED_CODE")].filter(Boolean) as string[],
  usdt: opt("USDT_ADDRESS") as Address,
  usdc: opt("USDC_ADDRESS") as Address,
  seller: {
    port: Number(opt("SELLER_PORT", "3402")),
    publicUrl: opt("SELLER_PUBLIC_URL"),
    facilitator: opt("X402_FACILITATOR_URL", "https://api.x402.celo.org"),
    apiKey: opt("X402_API_KEY"),
    payTo: opt("SELLER_PAY_TO") as Address,
    priceUsd: opt("BRIEF_PRICE_USD", "0.01"),
  },
  web: { port: Number(opt("WEB_PORT", "3000")), encKey: opt("SESSION_ENC_KEY") },
  telegramToken: opt("TELEGRAM_BOT_TOKEN"),
  cronHourUtc: Number(opt("AGENT_CRON_HOUR_UTC", "1")),
  identityRegistry: opt("IDENTITY_REGISTRY", "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432") as Address,
  ownerKey: () => req("AGENT_OWNER_PRIVATE_KEY") as Hex,
  agentCardUrl: opt("AGENT_CARD_URL"),
};
