import { describe, it, expect } from "vitest";
import { compileTradingLog } from "../src/compile.js";

describe("TradingLog compilation", () => {
  const { abi, bytecode } = compileTradingLog();

  // ---- ABI ----------------------------------------------------------------

  it("produces a non-empty ABI", () => {
    expect(Array.isArray(abi)).toBe(true);
    expect(abi.length).toBeGreaterThan(0);
  });

  it("ABI contains logTrade function", () => {
    const entry = abi.find(
      (e: any) => e.type === "function" && e.name === "logTrade",
    );
    expect(entry).toBeDefined();
  });

  it("ABI contains updateStrategy function", () => {
    const entry = abi.find(
      (e: any) => e.type === "function" && e.name === "updateStrategy",
    );
    expect(entry).toBeDefined();
  });

  it("ABI contains getTradeCount view function", () => {
    const entry = abi.find(
      (e: any) => e.type === "function" && e.name === "getTradeCount",
    );
    expect(entry).toBeDefined();
    expect((entry as any).stateMutability).toBe("view");
  });

  it("ABI contains getLastTrade view function", () => {
    const entry = abi.find(
      (e: any) => e.type === "function" && e.name === "getLastTrade",
    );
    expect(entry).toBeDefined();
    expect((entry as any).stateMutability).toBe("view");
  });

  it("ABI contains TradeLogged event", () => {
    const entry = abi.find(
      (e: any) => e.type === "event" && e.name === "TradeLogged",
    );
    expect(entry).toBeDefined();
  });

  it("ABI contains StrategyUpdated event", () => {
    const entry = abi.find(
      (e: any) => e.type === "event" && e.name === "StrategyUpdated",
    );
    expect(entry).toBeDefined();
  });

  // ---- Bytecode -----------------------------------------------------------

  it("produces non-empty bytecode", () => {
    expect(typeof bytecode).toBe("string");
    expect(bytecode.length).toBeGreaterThan(0);
  });

  it("bytecode is valid hex", () => {
    expect(bytecode).toMatch(/^[0-9a-fA-F]+$/);
  });
});
