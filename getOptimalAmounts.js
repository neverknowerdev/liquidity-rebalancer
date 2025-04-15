const { Position, Pool } = require('@uniswap/v3-sdk');


function getOptimalAmounts(pool, availableAmount0, availableAmount1, tickLower, tickUpper) {
    const position = Position.fromAmounts({
        pool,
        tickLower,
        tickUpper,
        availableAmount0,
        availableAmount1,
        useFullPrecision: true
    });

    const optimalAmount0Decimal = Number(position.amount0.toExact());
    const optimalAmount1Decimal = Number(position.amount1.toExact());

    return { token0Amount: optimalAmount0Decimal, token1Amount: optimalAmount1Decimal };
}

module.exports = getOptimalAmounts;