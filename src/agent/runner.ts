// Run once: npm run agent:once   |   Daily loop: npm run agent
import { tick, startDailyLoop } from "./agent.js";

if (process.argv.includes("--once")) await tick();
else startDailyLoop();
