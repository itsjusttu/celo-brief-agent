# VN Brief Agent

An agent that acts from the user's **Altana smart agentic wallet on Celo** under a capped session key
(spend cap per day, expiry, revocable in one tx). Every morning it **pays for a crypto brief over x402**
and delivers it to the user's Telegram in Vietnamese/English.

Built for Loops House × Celo "Agents Open for Business" — Altana Smart Agentic Wallets track
(+ Agent Vault track, optional).

```
 user (passkey = admin)                      Celo mainnet
   │ createPasskeyWallet + grantSession ──►  Altana KeyStore (cap, expiry)
   ▼
 web onboarding ──► Upstash Redis (serialized session + encrypted session key)
                          │
 Vercel Cron (daily) ─────┘── fetchWithX402 ──► seller /brief (x402, USDT)
        │                                          │ settle via api.x402.celo.org
        └── Telegram (webhook) ◄── brief ──────────┘
 ERC-8004 identity: agent card at /.well-known/agent-card.json
 ERC-8021 tags: createClient({ appCode }) on every Altana tx
```

## Run
Everything is one Hono app deployed as Vercel Functions (`src/index.ts`), with Upstash Redis
for state and a Vercel Cron at 01:00 UTC (`vercel.json`).
```
cp .env.example .env   # fill values (never commit .env)
npm install
npm test               # integration test: fake Redis + fake seller, no mainnet
npm run check:supported
npm run dev            # local server (needs Upstash vars)
npm run register8004   # ERC-8004 identity (dry run; add -- --send)
npm run telegram:webhook
```

Status: scaffold. Build steps are in `PROMPTS_CLAUDE_CODE.md`.
