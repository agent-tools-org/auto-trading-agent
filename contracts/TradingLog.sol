// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TradingLog — on-chain event log for autonomous trading agent actions
contract TradingLog {
    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event TradeLogged(
        address indexed agent,
        string pair,
        uint256 amountIn,
        uint256 amountOut,
        uint256 timestamp
    );

    event StrategyUpdated(
        address indexed agent,
        string strategy,
        uint256 timestamp
    );

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    struct Trade {
        string pair;
        uint256 amountIn;
        uint256 amountOut;
        uint256 timestamp;
    }

    Trade[] private trades;

    // -----------------------------------------------------------------------
    // Write functions
    // -----------------------------------------------------------------------

    function logTrade(
        string calldata pair,
        uint256 amountIn,
        uint256 amountOut
    ) external {
        trades.push(Trade(pair, amountIn, amountOut, block.timestamp));
        emit TradeLogged(msg.sender, pair, amountIn, amountOut, block.timestamp);
    }

    function updateStrategy(string calldata strategy) external {
        emit StrategyUpdated(msg.sender, strategy, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // View functions
    // -----------------------------------------------------------------------

    function getTradeCount() external view returns (uint256) {
        return trades.length;
    }

    function getLastTrade()
        external
        view
        returns (
            string memory pair,
            uint256 amountIn,
            uint256 amountOut,
            uint256 timestamp
        )
    {
        require(trades.length > 0, "No trades logged");
        Trade storage t = trades[trades.length - 1];
        return (t.pair, t.amountIn, t.amountOut, t.timestamp);
    }
}
