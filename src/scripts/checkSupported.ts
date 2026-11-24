// Shows which x402 schemes/assets the Celo facilitator supports. Run before coding the payment path.
import { cfg } from "../lib/config.js";
const r = await fetch(`${cfg.seller.facilitator}/supported`, { headers: { "X-API-Key": cfg.seller.apiKey } });
console.log(r.status, JSON.stringify(await r.json(), null, 2));
