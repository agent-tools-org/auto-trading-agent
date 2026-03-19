import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const solc = require("solc");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Compile TradingLog.sol
// ---------------------------------------------------------------------------

export function compileTradingLog(): { abi: unknown[]; bytecode: string } {
  const contractPath = resolve(ROOT, "contracts", "TradingLog.sol");
  const source = readFileSync(contractPath, "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "TradingLog.sol": { content: source },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  // Check for errors (warnings are OK)
  const errors = (output.errors ?? []).filter(
    (e: { severity: string }) => e.severity === "error",
  );
  if (errors.length > 0) {
    const messages = errors.map((e: { formattedMessage: string }) => e.formattedMessage);
    throw new Error(`Solidity compilation failed:\n${messages.join("\n")}`);
  }

  const contract = output.contracts["TradingLog.sol"]["TradingLog"];
  const abi = contract.abi as unknown[];
  const bytecode: string = contract.evm.bytecode.object;

  return { abi, bytecode };
}

// ---------------------------------------------------------------------------
// CLI: write artifacts/TradingLog.json
// ---------------------------------------------------------------------------

function main(): void {
  const { abi, bytecode } = compileTradingLog();

  const artifactsDir = resolve(ROOT, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });

  const outPath = resolve(artifactsDir, "TradingLog.json");
  writeFileSync(outPath, JSON.stringify({ abi, bytecode }, null, 2) + "\n");

  console.log(`Compiled TradingLog → ${outPath}`);
  console.log(`  ABI entries : ${abi.length}`);
  console.log(`  Bytecode    : ${bytecode.length} hex chars`);
}

// Run main only when executed directly (not imported)
const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.ts$/, "") === __filename.replace(/\.ts$/, "");

if (isMain) {
  main();
}
