import {
  createWalletClient,
  createPublicClient,
  http,
  type Address,
  type Hex,
  parseUnits,
  formatUnits,
  maxUint256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BASE_RPC_URL,
  CHAIN,
  DEX,
  TOKEN_DECIMALS,
  getPrivateKey,
  type TradingPair,
} from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeDirection = "buy" | "sell";
export type Venue = "aerodrome" | "uniswap";

export interface TradeProposal {
  pair: TradingPair;
  direction: TradeDirection;
  amountIn: bigint;
  venue: Venue;
  expectedPrice: number;
  maxSlippageBps: number;
}

export interface TradeResult {
  success: boolean;
  txHash: Hex | null;
  amountIn: bigint;
  amountOut: bigint;
  gasUsed: bigint;
  gasCostWei: bigint;
  venue: Venue;
  error?: string;
}

// ---------------------------------------------------------------------------
// ABIs (minimal — only what we call)
// ---------------------------------------------------------------------------

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const UNISWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const AERODROME_ROUTER_ABI = [
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    name: "getAmountsOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

// Aerodrome default pool factory
const AERODROME_FACTORY =
  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as Address;

// ---------------------------------------------------------------------------
// Swap executor
// ---------------------------------------------------------------------------

export class SwapExecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wallet: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private publicClient: any;
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(rpcUrl: string = BASE_RPC_URL) {
    this.account = privateKeyToAccount(getPrivateKey());
    this.wallet = createWalletClient({
      account: this.account,
      chain: CHAIN,
      transport: http(rpcUrl),
    });
    this.publicClient = createPublicClient({
      chain: CHAIN,
      transport: http(rpcUrl),
    });
  }

  get address(): Address {
    return this.account.address;
  }

  // ---- Token helpers ------------------------------------------------------

  async ensureApproval(
    token: Address,
    spender: Address,
    amount: bigint,
  ): Promise<void> {
    const allowance = await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.account.address, spender],
    });

    if (allowance < amount) {
      const hash = await this.wallet.writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, maxUint256],
        chain: CHAIN,
        account: this.account,
      });
      await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`[Executor] Approved ${token} for ${spender} — tx ${hash}`);
    }
  }

  async getBalance(token: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.account.address],
    });
  }

  // ---- Slippage / price impact estimation ---------------------------------

  computeMinAmountOut(
    expectedPrice: number,
    amountIn: bigint,
    decimalsIn: number,
    decimalsOut: number,
    slippageBps: number,
  ): bigint {
    const amtInFloat = Number(formatUnits(amountIn, decimalsIn));
    const expectedOut = amtInFloat * expectedPrice;
    const minOut = expectedOut * (1 - slippageBps / 10_000);
    // Convert back to integer with correct decimals
    return parseUnits(minOut.toFixed(decimalsOut), decimalsOut);
  }

  // ---- Uniswap V3 swap ---------------------------------------------------

  async executeUniswapSwap(proposal: TradeProposal): Promise<TradeResult> {
    const { pair, direction, amountIn, maxSlippageBps, expectedPrice } =
      proposal;

    const tokenIn = direction === "buy" ? pair.quote : pair.base;
    const tokenOut = direction === "buy" ? pair.base : pair.quote;
    const decimalsIn = TOKEN_DECIMALS[tokenIn] ?? 18;
    const decimalsOut = TOKEN_DECIMALS[tokenOut] ?? 18;

    // Adjust expected price for direction
    const priceForCalc = direction === "buy" ? 1 / expectedPrice : expectedPrice;
    const amountOutMinimum = this.computeMinAmountOut(
      priceForCalc,
      amountIn,
      decimalsIn,
      decimalsOut,
      maxSlippageBps,
    );

    try {
      await this.ensureApproval(tokenIn, DEX.UNISWAP_ROUTER, amountIn);

      const hash = await this.wallet.writeContract({
        address: DEX.UNISWAP_ROUTER,
        abi: UNISWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            fee: pair.uniswapFeeTier,
            recipient: this.account.address,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96: 0n,
          },
        ],
        chain: CHAIN,
        account: this.account,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
        amountIn,
        amountOut: amountOutMinimum, // conservative estimate
        gasUsed: BigInt(receipt.gasUsed),
        gasCostWei: BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice),
        venue: "uniswap",
      };
    } catch (err: any) {
      return {
        success: false,
        txHash: null,
        amountIn,
        amountOut: 0n,
        gasUsed: 0n,
        gasCostWei: 0n,
        venue: "uniswap",
        error: err.message ?? String(err),
      };
    }
  }

  // ---- Aerodrome V2 swap --------------------------------------------------

  async executeAerodromeSwap(proposal: TradeProposal): Promise<TradeResult> {
    const { pair, direction, amountIn, maxSlippageBps, expectedPrice } =
      proposal;

    const tokenIn = direction === "buy" ? pair.quote : pair.base;
    const tokenOut = direction === "buy" ? pair.base : pair.quote;
    const decimalsIn = TOKEN_DECIMALS[tokenIn] ?? 18;
    const decimalsOut = TOKEN_DECIMALS[tokenOut] ?? 18;

    const priceForCalc = direction === "buy" ? 1 / expectedPrice : expectedPrice;
    const amountOutMin = this.computeMinAmountOut(
      priceForCalc,
      amountIn,
      decimalsIn,
      decimalsOut,
      maxSlippageBps,
    );

    const routes = [
      {
        from: tokenIn,
        to: tokenOut,
        stable: false as const,
        factory: AERODROME_FACTORY,
      },
    ];

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min

    try {
      await this.ensureApproval(tokenIn, DEX.AERODROME_ROUTER, amountIn);

      const hash = await this.wallet.writeContract({
        address: DEX.AERODROME_ROUTER,
        abi: AERODROME_ROUTER_ABI,
        functionName: "swapExactTokensForTokens",
        args: [amountIn, amountOutMin, routes, this.account.address, deadline],
        chain: CHAIN,
        account: this.account,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
        amountIn,
        amountOut: amountOutMin,
        gasUsed: BigInt(receipt.gasUsed),
        gasCostWei: BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice),
        venue: "aerodrome",
      };
    } catch (err: any) {
      return {
        success: false,
        txHash: null,
        amountIn,
        amountOut: 0n,
        gasUsed: 0n,
        gasCostWei: 0n,
        venue: "aerodrome",
        error: err.message ?? String(err),
      };
    }
  }

  // ---- Unified execute ----------------------------------------------------

  async execute(proposal: TradeProposal): Promise<TradeResult> {
    console.log(
      `[Executor] Executing ${proposal.direction} on ${proposal.venue} ` +
        `for ${proposal.pair.name} — amount ${proposal.amountIn}`,
    );

    if (proposal.venue === "uniswap") {
      return this.executeUniswapSwap(proposal);
    }
    return this.executeAerodromeSwap(proposal);
  }

  // ---- Quote (read-only estimate) -----------------------------------------

  async quoteAerodrome(
    pair: TradingPair,
    direction: TradeDirection,
    amountIn: bigint,
  ): Promise<bigint> {
    const tokenIn = direction === "buy" ? pair.quote : pair.base;
    const tokenOut = direction === "buy" ? pair.base : pair.quote;

    const routes = [
      {
        from: tokenIn,
        to: tokenOut,
        stable: false as const,
        factory: AERODROME_FACTORY,
      },
    ];

    try {
      const amounts = await this.publicClient.readContract({
        address: DEX.AERODROME_ROUTER,
        abi: AERODROME_ROUTER_ABI,
        functionName: "getAmountsOut",
        args: [amountIn, routes],
      });
      return amounts[amounts.length - 1];
    } catch {
      return 0n;
    }
  }
}
