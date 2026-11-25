// Tiny JSON-file store. Session keys are encrypted at rest (AES-256-GCM).
// Never JSON.stringify an Altana Session — use serializeSession().
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { cfg } from "./config.js";
import type { SerializedSession } from "@altananetwork/sdk";

export type RunLog = {
  at: number;
  ok: boolean;
  txHash?: string;    // x402 settlement tx (from the PAYMENT-RESPONSE header)
  code?: string;      // AltanaError code or our own failure code
  note?: string;
};

export type UserRecord = {
  id: string;                 // short id, also used in referral links
  telegramChatId: string;
  walletAddress: string;
  serializedSession: SerializedSession; // output of serializeSession(), contains NO secret
  encSessionKey: string;      // encrypted session private key
  createdAt: number;
  displayName?: string;       // for "named user" (with consent)
  lastRunAt?: number;
  /** Set when a run fails for a reason a retry will not fix; cleared on the next success. */
  pausedCode?: string;
  runs: RunLog[];
};

// On Railway, DATA_DIR is the volume's mount path (e.g. /data). Locally: ./data
const DIR = process.env.DATA_DIR || "data";
const FILE = `${DIR}/users.json`;

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

export function loadUsers(): UserRecord[] {
  if (!existsSync(FILE)) return [];
  return JSON.parse(readFileSync(FILE, "utf8"));
}
/** Atomic write (tmp + rename) so a crash never leaves a half-written file. */
export function saveUsers(users: UserRecord[]) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(users, null, 2));
  renameSync(tmp, FILE);
}
/** Re-reads the file right before writing, to keep lost updates between the web and agent processes rare. */
export function updateUser(id: string, fn: (u: UserRecord) => void) {
  const all = loadUsers();
  const u = all.find((x) => x.id === id);
  if (!u) return;
  fn(u);
  saveUsers(all);
}
export function upsertUser(u: UserRecord) {
  const all = loadUsers().filter((x) => x.id !== u.id);
  all.push(u);
  saveUsers(all);
}
