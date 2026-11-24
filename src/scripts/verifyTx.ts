// Usage: npm run verify:tx -- 0xTXHASH   -> prints every ERC-8021 tag found in the tx calldata.
//
// A tx we send from an EOA carries the tag at the END of its calldata. A tx the Altana
// relay sends carries it at the end of an INNER call, buried inside the outer calldata,
// where a plain suffix check (or @celo/attribution-tags verifyTx) finds nothing.
// So we scan for every occurrence of the 16-byte ERC-8021 marker and decode the tag before it.
import { createPublicClient, http, type Hex } from "viem";
import { celo } from "viem/chains";
import { ERC_8021_MARKER, fromDataSuffix } from "@celo/attribution-tags";
import { cfg } from "../lib/config.js";

const hash = process.argv[2] as Hex | undefined;
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("usage: npm run verify:tx -- 0x<tx hash>");

const pub = createPublicClient({ chain: celo, transport: http(cfg.rpc) });
const tx = await pub.getTransaction({ hash });
const input = tx.input.toLowerCase();
const marker = ERC_8021_MARKER.slice(2).toLowerCase();

const found: { position: "end of calldata" | "inner call"; codes: string[] }[] = [];
for (let i = input.indexOf(marker); i !== -1; i = input.indexOf(marker, i + 1)) {
  const end = i + marker.length;
  const decoded = fromDataSuffix(input.slice(0, end) as Hex);
  if (decoded) found.push({ position: end === input.length ? "end of calldata" : "inner call", codes: decoded.codes });
}

const assigned = process.env.CELO_ASSIGNED_CODE ?? "";
console.log(`tx ${hash}\n  from ${tx.from}\n  to   ${tx.to}`);
if (found.length === 0) console.log("  ❌ no ERC-8021 tag found");
for (const f of found) console.log(`  tag (${f.position}): ${f.codes.join(",")}`);
const ok = found.some((f) => f.codes.includes(assigned));
console.log(ok ? `  ✅ carries ${assigned}` : `  ❌ does NOT carry ${assigned || "CELO_ASSIGNED_CODE (unset)"}`);
if (ok && !found.some((f) => f.position === "end of calldata"))
  console.log("  ℹ️  tag is inside a relayed call: paste this hash on the Loops Celo checklist (auto-scan won't find it).");
process.exitCode = ok ? 0 : 1;
