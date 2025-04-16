"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOptimalAmounts2 = getOptimalAmounts2;
function getOptimalAmounts2(amount0, amount1, price, lowerTick, upperTick, currentTick) {
    const sqrtUpper = priceToSqrtP(Number(upperTick));
    const sqrtLower = priceToSqrtP(Number(lowerTick));
    const sqrtCurrent = priceToSqrtP(Number(currentTick));
    // const liq0 = liquidity0(amount0, sqrtCurrent, sqrtUpper);
    // const liq1 = liquidity1(amount1, sqrtCurrent, sqrtLower);
    const totalLiquidity = 1000000n;
    console.log('totalLiquidity', price, totalLiquidity);
    const newAmount0 = calcAmount0(1n, sqrtUpper, sqrtCurrent);
    const newAmount1 = calcAmount1(100000000n, sqrtLower, sqrtCurrent);
    return {
        token0Amount: Number(newAmount0),
        token1Amount: Number(newAmount1),
    };
}
// Constant for Q96 (2^96), using bigint for precision
const Q96 = BigInt(2) ** BigInt(96);
// Converts a price to a Uniswap tick
function priceToTick(p) {
    return Math.floor(Math.log(p) / Math.log(1.0001));
}
// Converts a price to sqrt price (sqrtPriceX96)
function priceToSqrtP(p) {
    return BigInt(Math.floor(Math.sqrt(p) * Number(Q96)));
}
// Calculates liquidity for token0 given an amount and price range
function liquidity0(amount, pa, pb) {
    let [lower, upper] = pa > pb ? [pb, pa] : [pa, pb];
    // (amount * (pa * pb) / Q96) / (pb - pa)
    return (amount * (lower * upper) / Q96) / (upper - lower);
}
// Calculates liquidity for token1 given an amount and price range
function liquidity1(amount, pa, pb) {
    let [lower, upper] = pa > pb ? [pb, pa] : [pa, pb];
    // amount * Q96 / (pb - pa)
    return (amount * Q96) / (upper - lower);
}
// Calculates token0 amount given liquidity and price range
function calcAmount0(liq, pa, pb) {
    let [lower, upper] = pa > pb ? [pb, pa] : [pa, pb];
    // liq * Q96 * (pb - pa) / pa / pb
    return (liq * Q96 * (upper - lower)) / lower / upper;
}
// Calculates token1 amount given liquidity and price range
function calcAmount1(liq, pa, pb) {
    let [lower, upper] = pa > pb ? [pb, pa] : [pa, pb];
    // liq * (pb - pa) / Q96
    return (liq * (upper - lower)) / Q96;
}
