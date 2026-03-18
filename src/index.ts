import { TradingAgent } from "./agent/trading-agent.js";

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const agent = new TradingAgent();

function shutdown(): void {
  console.log("\n[Main] Shutting down gracefully…");
  agent.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[Main] Starting Autonomous Trading Agent on Base…");
agent.start();
