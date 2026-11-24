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
 web onboarding ──► data/users.json (serialized session + encrypted session key)
                          │
 agent runner (daily) ────┘── fetchWithX402 ──► seller /brief (x402, USDT)
        │                                          │ settle via api.x402.celo.org
        └── Telegram bot ◄──── brief ──────────────┘
 ERC-8004 identity: agent card at /.well-known/agent-card.json
 ERC-8021 tags: createClient({ appCode }) on every Altana tx
```

## Run
```
cp .env.example .env   # fill values
npm install
npm run check:supported
npm run seller         # x402 API
npm run web            # onboarding
npm run agent:once     # one pass for all users
npm run register8004   # ERC-8004 identity
```

Status: scaffold. Build steps are in `PROMPTS_CLAUDE_CODE.md`.
