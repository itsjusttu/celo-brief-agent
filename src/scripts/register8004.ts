// Register the agent on the ERC-8004 Identity Registry (Celo mainnet), tagged with ERC-8021.
// Must be sent FROM the wallet registered on the hackathon entry, before Dec 7.
// NOTE(Claude Code): confirm the register() overload in the official ABI:
// https://github.com/celo-org/agent-skills (skills/8004/references/identity-registry-abi.json)
// Alternative: Altana's erc8004RegisterPermissions() to register from the Altana wallet.
import { createPublicClient, createWalletClient, http, encodeFunctionData, concat, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { toDataSuffix } from "@celo/attribution-tags";
import { cfg } from "../lib/config.js";

const abi = parseAbi(["function register(string agentURI) returns (uint256 agentId)"]);

const account = privateKeyToAccount(cfg.ownerKey());
const wallet = createWalletClient({ account, chain: celo, transport: http(cfg.rpc) });
const pub = createPublicClient({ chain: celo, transport: http(cfg.rpc) });

if (!cfg.agentCardUrl) throw new Error("AGENT_CARD_URL missing");
const data = concat([
  encodeFunctionData({ abi, functionName: "register", args: [cfg.agentCardUrl] }),
  toDataSuffix(cfg.appCodes),
]);
const hash = await wallet.sendTransaction({ to: cfg.identityRegistry, data });
console.log("tx", hash);
const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log("status", rcpt.status, "— check celoscan for the minted agentId (Transfer event)");
