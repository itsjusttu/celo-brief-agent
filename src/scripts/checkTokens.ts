// Reads name/symbol/decimals of the configured tokens on Celo mainnet (read-only, free).
// Guards against the 18-decimal fee-currency adapters that share the same name/symbol.
import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { celo } from "viem/chains";
import { cfg, TOKENS } from "../lib/config.js";

const erc20 = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const pub = createPublicClient({ chain: celo, transport: http(cfg.rpc) });

let bad = false;
for (const [label, address, expected] of [
  ["USDT", cfg.usdt, TOKENS.USDT],
  ["USDC", cfg.usdc, TOKENS.USDC],
] as const) {
  const [name, symbol, decimals] = await Promise.all(
    (["name", "symbol", "decimals"] as const).map((fn) => pub.readContract({ address, abi: erc20, functionName: fn })),
  );
  const ok = Number(decimals) === expected.decimals && getAddress(address) === getAddress(expected.address);
  bad ||= !ok;
  console.log(`${ok ? "✅" : "❌"} ${label} ${address}  name="${name}" symbol=${symbol} decimals=${decimals}`);
}
process.exitCode = bad ? 1 : 0;
