// Usage: npm run verify:tx -- 0xTXHASH   -> prints the ERC-8021 codes found in calldata
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { parseAttribution } from "@altananetwork/sdk";
import { cfg } from "../lib/config.js";

const hash = process.argv[2] as `0x${string}`;
if (!hash) throw new Error("pass a tx hash");
const pub = createPublicClient({ chain: celo, transport: http(cfg.rpc) });
const tx = await pub.getTransaction({ hash });
console.log(parseAttribution(tx.input));
