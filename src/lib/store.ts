// Tiny JSON-file store. Session keys are encrypted at rest (AES-256-GCM).
// Never JSON.stringify an Altana Session — use serializeSession().
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { cfg } from "./config.js";
import type { SerializedSession } from "@altananetwork/sdk";

export type UserRecord = {
  id: string;                 // short id, also used in referral links
  telegramChatId: string;
  walletAddress: string;
  serializedSession: SerializedSession; // output of serializeSession(), contains NO secret
  encSessionKey: string;      // encrypted session private key
  createdAt: number;
  displayName?: string;       // for "named user" (with consent)
  lastRunAt?: number;
  runs: { at: number; ok: boolean; note?: string }[];
};

const DIR = "data";
const FILE = `${DIR}/users.json`;

function key(): Buffer {
  if (!cfg.web.encKey || cfg.web.encKey.length !== 64) throw new Error("SESSION_ENC_KEY must be 32-byte hex");
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
export function saveUsers(users: UserRecord[]) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(users, null, 2));
}
export function upsertUser(u: UserRecord) {
  const all = loadUsers().filter((x) => x.id !== u.id);
  all.push(u);
  saveUsers(all);
}
