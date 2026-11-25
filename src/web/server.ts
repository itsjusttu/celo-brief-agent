// Local dev: onboarding web only.  npm run web
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cfg } from "../lib/config.js";
import { createWebApp } from "./app.js";

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/", createWebApp());

serve({ fetch: app.fetch, port: cfg.web.port });
console.log(`web on :${cfg.web.port}`);
