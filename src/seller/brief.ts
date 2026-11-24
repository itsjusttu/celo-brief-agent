// Builds the paid content: a short bilingual (VI/EN) market brief.
// Data: CoinGecko public API (no key). Replace/extend with better sources later.
type Coin = { id: string; symbol: string; current_price: number; price_change_percentage_24h: number };

export async function buildBrief(): Promise<{ text: string; data: Coin[] }> {
  const ids = "bitcoin,ethereum,celo,solana,binancecoin";
  const r = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`,
  );
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const data = (await r.json()) as Coin[];
  const lines = data.map((c) => {
    const ch = c.price_change_percentage_24h ?? 0;
    const arrow = ch >= 0 ? "🟢" : "🔴";
    return `${arrow} <b>${c.symbol.toUpperCase()}</b> $${c.current_price.toLocaleString("en-US")} (${ch.toFixed(2)}%)`;
  });
  const date = new Date().toISOString().slice(0, 10);
  const text = [`📊 <b>Bản tin crypto / Crypto brief</b> — ${date}`, "", ...lines].join("\n");
  // TODO(Claude Code): add 1–2 lines of on-chain context for Celo (e.g. stablecoin volume)
  return { text, data };
}
