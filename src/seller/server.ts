// Local dev: seller only.  npm run seller
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cfg } from "../lib/config.js";
import { createSellerApp } from "./app.js";

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/", createSellerApp());

serve({ fetch: app.fetch, port: cfg.seller.port });
console.log(`seller on :${cfg.seller.port}  (public: ${cfg.seller.publicUrl})`);
