import "dotenv/config";
import { isAddress, type Address, type Hex } from "viem";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see .env.example)`);
  return v;
}
const opt = (name: string, d = "") => process.env[name] || d;

function addr(name: string, d = ""): Address {
  const v = opt(name, d);
  if (v && !isAddress(v)) throw new Error(`env ${name} is not a valid address`);
  return v as Address;
}

// Celo mainnet token addresses, checked against docs.celo.org/tooling/contracts/token-contracts
// and x402.celo.org/skill.md. Both use 6 decimals. Do NOT use the 18-decimal
// fee-currency adapters (USDT adapter 0x0E2A3e05…, USDC adapter 0x2F25deB3…) here.
export const TOKENS = {
  USDT: { address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address, decimals: 6, eip712: { name: "Tether USD", version: "1" } },
  USDC: { address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as Address, decimals: 6, eip712: { name: "USDC", version: "2" } },
} as const;

const CODE_RE = /^[a-z0-9_]{1,32}$/;

export const cfg = {
  rpc: opt("CELO_RPC", "https://forno.celo.org"),
  chainId: Number(opt("CHAIN_ID", "42220")),
  /**
   * ERC-8021 codes for every tx we send: our own code + the code Loops assigned.
   * Throws instead of letting an untagged (= never credited) tx go out.
   */
  appCodes(): string[] {
    const own = opt("APP_CODE", "vn_brief_agent");
    const assigned = req("CELO_ASSIGNED_CODE");
    if (!/^celo_[0-9a-f]{12}$/.test(assigned)) throw new Error("CELO_ASSIGNED_CODE must look like celo_ + 12 hex chars");
    for (const c of [own, assigned]) if (!CODE_RE.test(c)) throw new Error(`invalid attribution code: ${c}`);
    return [own, assigned];
  },
  usdt: addr("USDT_ADDRESS", TOKENS.USDT.address),
  usdc: addr("USDC_ADDRESS", TOKENS.USDC.address),
  seller: {
    port: Number(opt("SELLER_PORT", "3402")),
    publicUrl: opt("SELLER_PUBLIC_URL").replace(/\/+$/, ""),
    facilitator: opt("X402_FACILITATOR_URL", "https://api.x402.celo.org"),
    apiKey: opt("X402_API_KEY"),
    /** "" until a real address is set; only the seller requires it. */
    payTo: (isAddress(opt("SELLER_PAY_TO")) ? opt("SELLER_PAY_TO") : "") as Address,
    priceUsd: opt("BRIEF_PRICE_USD", "0.01"),
  },
  web: { port: Number(opt("WEB_PORT", "3000")), encKey: opt("SESSION_ENC_KEY") },
  telegramToken: opt("TELEGRAM_BOT_TOKEN"),
  cronHourUtc: Number(opt("AGENT_CRON_HOUR_UTC", "1")),
  identityRegistry: addr("IDENTITY_REGISTRY", "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"),
  /** The agent wallet registered on the Loops entry. Scripts refuse to send from any other key. */
  agentWallet: addr("AGENT_WALLET", "0x4De2308D558E01B0Aa1b5371A4d0b26D2e2988d1"),
  ownerKey(): Hex {
    const k = req("AGENT_OWNER_PRIVATE_KEY").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("AGENT_OWNER_PRIVATE_KEY must be 0x + 64 hex chars");
    return k as Hex;
  },
  agentCardUrl: opt("AGENT_CARD_URL"),
};
