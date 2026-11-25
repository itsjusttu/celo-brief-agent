import { waitUntil } from "@vercel/functions";

/**
 * Run work after the response is sent. On Vercel, waitUntil keeps the function alive
 * until the promise settles (bounded by maxDuration: 300 s on Hobby). Locally it is a
 * no-op and Node simply keeps running the promise.
 */
export function background(label: string, work: () => Promise<unknown>) {
  const p = work().catch((e) => console.error(`[${label}] failed:`, e?.message ?? e));
  waitUntil(p);
  return p;
}
