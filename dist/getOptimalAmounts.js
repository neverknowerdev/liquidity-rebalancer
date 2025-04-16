"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const v4_sdk_1 = require("@uniswap/v4-sdk");
const ethers_1 = require("ethers");
function getOptimalAmounts(pool, price, availableAmount0, availableAmount1, tickLower, tickUpper, slippage) {
    const token0decimals = pool.token0.decimals;
    const token1decimals = pool.token1.decimals;
    const token0amount = Number(ethers_1.ethers.utils.formatUnits(availableAmount0.toString(), token0decimals));
    const token1amount = Number(ethers_1.ethers.utils.formatUnits(availableAmount1.toString(), token1decimals));
    const token1InToken0Amount = token1amount / price;
    let totalLiquidityInToken0Number = token0amount + token1InToken0Amount;
    if (slippage) {
        if (slippage > 0.10 || slippage < 0) {
            throw new Error("wrong slippage, should be as a percent, like 0.01 for 1%");
        }
        totalLiquidityInToken0Number = totalLiquidityInToken0Number - totalLiquidityInToken0Number * slippage;
    }
    const totalLiquidityInToken0 = amountToBigInt(totalLiquidityInToken0Number, token0decimals);
    let position;
    let currentLiquidityInToken0 = totalLiquidityInToken0 / 2n;
    for (;;) {
        position = v4_sdk_1.Position.fromAmount0({
            pool,
            tickLower,
            tickUpper,
            amount0: currentLiquidityInToken0.toString(),
            useFullPrecision: true
        });
        const newTotalAmount = Number(position.amount0.toExact()) + Number(position.amount1.toExact()) / price;
        const diff = Math.abs(newTotalAmount - totalLiquidityInToken0Number) / totalLiquidityInToken0Number;
        if (diff <= 0.0003) {
            break;
        }
        if (newTotalAmount > totalLiquidityInToken0Number) {
            const diff = totalLiquidityInToken0 - currentLiquidityInToken0;
            currentLiquidityInToken0 -= (diff < 0 ? -1n * diff : diff) / 2n;
            // currentLiquidityInToken0 -= BigInt(Math.abs(Number(totalLiquidityInToken0 - currentLiquidityInToken0)) )/2n;
        }
        else if (newTotalAmount < totalLiquidityInToken0Number) {
            const diff = totalLiquidityInToken0 - currentLiquidityInToken0;
            currentLiquidityInToken0 += (diff < 0 ? -1n * diff : diff) / 2n;
            // currentLiquidityInToken0 += BigInt(Math.abs(Number(currentLiquidityInToken0 - totalLiquidityInToken0)))/2n;
        }
    }
    const optimalAmount0 = Number(position.amount0.toExact());
    const optimalAmount1 = Number(position.amount1.toExact());
    return {
        token0Amount: amountToBigInt(optimalAmount0, token0decimals),
        token0AmountNumber: optimalAmount0,
        token1Amount: amountToBigInt(optimalAmount1, token1decimals),
        token1AmountNumber: optimalAmount1,
    };
    //
    // const position2 = Position.fromAmount1({pool, tickLower, tickUpper, amount1: availableAmount1});
    //
    // console.log('position1', position1.amount0.toExact(), position1.amount1.toExact());
    // console.log('position2', position2.amount0.toExact(), position2.amount1.toExact());
    //
    // const optimalAmount0Decimal = Number(position1.amount0.toExact());
    // const optimalAmount1Decimal = Number(position1.amount1.toExact());
    //
    // return { token0Amount: optimalAmount0Decimal, token1Amount: optimalAmount1Decimal };
}
function amountToBigInt(amount, decimals) {
    return ethers_1.ethers.utils.parseUnits((amount).toFixed(decimals), decimals).toBigInt();
}
//
// function convertToken1ToToken0(
//     token0Amount: number,
//     token1Amount: number,
//     price: number,
//     token0Decimals = 6,
//     token1Decimals = 18
// ) {
//     // Convert amounts to raw values (accounting for decimals)
//     const token1Raw = BigInt(Math.floor(token1Amount * 10 ** token1Decimals));
//
//     // Price is assumed to be token1/token0 (how many token1 per token0)
//     // To get token0 amount: token1Amount * price (adjusted for decimals)
//     const decimalDiff = token1Decimals - token0Decimals;
//     const priceAdjusted = BigInt(Math.floor(price * 10 ** decimalDiff));
//
//     // Calculate equivalent token0 amount
//     const token0Raw = (token1Raw * priceAdjusted) / BigInt(10 ** token1Decimals);
//
//     // Convert back to human-readable format with token0 decimals
//     const token0Equivalent = Number(token0Raw) / 10 ** token0Decimals;
//
//     return token0Equivalent;
// }
exports.default = getOptimalAmounts;
