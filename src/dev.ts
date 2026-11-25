// Local dev server: npm run dev  (needs the Upstash vars in .env)
import { serve } from "@hono/node-server";
import { cfg } from "./lib/config.js";
import { createApp } from "./service.js";

const port = Number(process.env.PORT || cfg.web.port);
serve({ fetch: createApp().fetch, port });
console.log(`dev on :${port}  public ${cfg.publicUrl()}`);
