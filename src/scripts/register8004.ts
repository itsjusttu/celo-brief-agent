// Register the agent on the ERC-8004 Identity Registry (Celo mainnet), tagged with ERC-8021.
// Must be sent FROM the agent wallet registered on the Loops entry, before Dec 7.
//
//   npm run register8004            -> dry run: checks everything, prints the cost, sends nothing
//   npm run register8004 -- --send  -> sends the transaction
//
// ABI: register(string agentURI) returns (uint256 agentId), one of three overloads in
// celo-org/agent-skills skills/8004/references/identity-registry-abi.json.
// The agentId comes from the Registered event on the receipt (docs.celo.org/build-on-celo/build-with-ai/8004).
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, formatEther, encodeFunctionData, isAddressEqual } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { withAttribution, toDataSuffix, verifyTx } from "@celo/attribution-tags";
import { cfg } from "../lib/config.js";

const abi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
const send = process.argv.includes("--send");

if (!cfg.agentCardUrl || cfg.agentCardUrl.includes("example")) throw new Error("AGENT_CARD_URL is not set to the real, stable URL");
const codes = cfg.appCodes(); // throws if the assigned code is missing
const account = privateKeyToAccount(cfg.ownerKey());
if (!isAddressEqual(account.address, cfg.agentWallet))
  throw new Error(`key belongs to ${account.address}, not the registered agent wallet ${cfg.agentWallet}`);

const pub = createPublicClient({ chain: celo, transport: http(cfg.rpc) });
const wallet = createWalletClient({ account, chain: celo, transport: http(cfg.rpc) }).extend(withAttribution(codes));

// The agent card must be reachable before we point the registry at it.
const card = await fetch(cfg.agentCardUrl).catch(() => null);
if (!card?.ok) throw new Error(`agent card not reachable at ${cfg.agentCardUrl} (${card?.status ?? "network error"})`);

const already = await pub.readContract({ address: cfg.identityRegistry, abi, functionName: "balanceOf", args: [account.address] });
const data = encodeFunctionData({ abi, functionName: "register", args: [cfg.agentCardUrl] }) + toDataSuffix(codes).slice(2);
const [gas, gasPrice, balance] = await Promise.all([
  pub.estimateGas({ account, to: cfg.identityRegistry, data: data as `0x${string}` }),
  pub.getGasPrice(),
  pub.getBalance({ address: account.address }),
]);

console.log(`from      ${account.address}  (balance ${formatEther(balance)} CELO)`);
console.log(`registry  ${cfg.identityRegistry}`);
console.log(`agentURI  ${cfg.agentCardUrl}`);
console.log(`tags      ${codes.join(",")}`);
console.log(`existing  ${already} identity NFT(s) already owned by this wallet`);
console.log(`cost      ~${formatEther(gas * gasPrice)} CELO (gas ${gas} @ ${gasPrice} wei)`);

if (!send) {
  console.log("\nDry run only. Re-run with `-- --send` to register.");
  process.exit(0);
}

const hash = await wallet.writeContract({ address: cfg.identityRegistry, abi, functionName: "register", args: [cfg.agentCardUrl] });
console.log("tx", hash);
const rcpt = await pub.waitForTransactionReceipt({ hash });
const [ev] = parseEventLogs({ abi, logs: rcpt.logs, eventName: "Registered" });
console.log("status ", rcpt.status);
console.log("agentId", ev ? ev.args.agentId.toString() : "(Registered event not found — check celoscan)");
const tag = await verifyTx({ client: pub, hash });
console.log("tag    ", tag?.codes.join(",") ?? "❌ none");
