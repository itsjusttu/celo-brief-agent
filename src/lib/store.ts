// Upstash Redis store (Vercel Marketplace). Session keys are encrypted at rest (AES-256-GCM).
// Never JSON.stringify an Altana Session — use serializeSession().
//
// Keys (prefix vnb:):
//   users                 SET of user ids
//   user:{id}             UserRecord (JSON)
//   wallet:{addr}         -> user id        (one record per wallet; re-onboarding updates it)
//   chat:{chatId}         -> user id        (Telegram -> user)
//   link:{code}           -> user id        (one-time Telegram deep-link code, 24 h)
//   runs:{id}             LIST of RunLog, newest first (traction evidence), capped
//   claim:{day}:{id}      daily payment claim — the anti double-charge guard (see claimDaily)
//   ondemand:{id}         /brief rate limit
import { Redis } from "@upstash/redis";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { cfg } from "./config.js";
import type { SerializedSession } from "@altananetwork/sdk";

export type RunLog = {
  at: number;
  ok: boolean;
  scheduled: boolean;  // daily run vs on-demand /brief
  txHash?: string;     // x402 settlement tx (from the PAYMENT-RESPONSE header)
  code?: string;       // AltanaError code or our own failure code
  note?: string;
};

export type UserRecord = {
  id: string;
  walletAddress: string;
  serializedSession: SerializedSession; // output of serializeSession(), contains NO secret
  encSessionKey: string;                // encrypted session private key
  telegramChatId?: string;              // bound via the /start deep link
  createdAt: number;
  displayName?: string;                 // for "named user" (with consent)
  /** Set when a run fails for a reason a retry will not fix; cleared on the next success. */
  pausedCode?: string;
};

const P = "vnb:";
let _redis: Redis | undefined;
// Reads UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN (both names the Vercel integration may set).
export const redis = () => (_redis ??= Redis.fromEnv());

// ---------- encryption ----------
function key(): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(cfg.web.encKey)) throw new Error("SESSION_ENC_KEY must be 32-byte hex");
  return Buffer.from(cfg.web.encKey, "hex");
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("hex")).join(".");
}
export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((h) => Buffer.from(h, "hex"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---------- users ----------
export async function listUserIds(): Promise<string[]> {
  return (await redis().smembers(`${P}users`)).sort();
}
export async function getUser(id: string): Promise<UserRecord | null> {
  return redis().get<UserRecord>(`${P}user:${id}`);
}
export async function saveUser(u: UserRecord) {
  const tx = redis().multi();
  tx.set(`${P}user:${u.id}`, u);
  tx.sadd(`${P}users`, u.id);
  tx.set(`${P}wallet:${u.walletAddress.toLowerCase()}`, u.id);
  if (u.telegramChatId) tx.set(`${P}chat:${u.telegramChatId}`, u.id);
  await tx.exec();
}
export async function userIdForWallet(addr: string): Promise<string | null> {
  return redis().get<string>(`${P}wallet:${addr.toLowerCase()}`);
}
export async function userIdForChat(chatId: string): Promise<string | null> {
  return redis().get<string>(`${P}chat:${chatId}`);
}

// ---------- Telegram deep-link codes ----------
export async function createLinkCode(userId: string): Promise<string> {
  const code = randomBytes(12).toString("base64url"); // [A-Za-z0-9_-], valid for /start payloads
  await redis().set(`${P}link:${code}`, userId, { ex: 86_400 });
  return code;
}
/** One-time: returns the user id and deletes the code. */
export async function consumeLinkCode(code: string): Promise<string | null> {
  return redis().getdel<string>(`${P}link:${code}`);
}

// ---------- run log ----------
export async function appendRun(id: string, log: RunLog) {
  const tx = redis().multi();
  tx.lpush(`${P}runs:${id}`, log);
  tx.ltrim(`${P}runs:${id}`, 0, 499);
  await tx.exec();
}
export async function getRuns(id: string, n = 50): Promise<RunLog[]> {
  return redis().lrange<RunLog>(`${P}runs:${id}`, 0, n - 1);
}

// ---------- anti double-charge ----------
//
// One claim per user per UTC day, taken with SET NX BEFORE paying:
//   pending  -> a run is (or was) paying right now. If the function died mid-payment we
//               cannot know whether money moved, so a stale "pending" is NEVER retried
//               automatically: it shows up in /api/cron/status for a human to check celoscan.
//   ok       -> paid today, skip.
//   failed   -> failed for a reason a retry won't fix today (cap, expiry, no funds), skip.
// Transient failures (relay/network/5xx) release the claim so a re-run can try again —
// those fail before any payment settles.
export type ClaimState = { state: "pending" | "ok" | "failed"; at: number; txHash?: string; code?: string };
const CLAIM_TTL = 3 * 86_400;

export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

export async function claimDaily(day: string, id: string): Promise<boolean> {
  const r = await redis().set(`${P}claim:${day}:${id}`, { state: "pending", at: Date.now() } satisfies ClaimState, {
    nx: true,
    ex: CLAIM_TTL,
  });
  return r === "OK";
}
export async function settleClaim(day: string, id: string, s: ClaimState) {
  await redis().set(`${P}claim:${day}:${id}`, s, { ex: CLAIM_TTL });
}
export async function releaseClaim(day: string, id: string) {
  await redis().del(`${P}claim:${day}:${id}`);
}
export async function getClaims(day: string, ids: string[]): Promise<(ClaimState | null)[]> {
  if (ids.length === 0) return [];
  return redis().mget<(ClaimState | null)[]>(...ids.map((id) => `${P}claim:${day}:${id}`));
}

/** /brief rate limit: at most one on-demand paid brief per user per `seconds`. */
export async function claimOnDemand(id: string, seconds = 600): Promise<boolean> {
  return (await redis().set(`${P}ondemand:${id}`, Date.now(), { nx: true, ex: seconds })) === "OK";
}
