const { ethers } = require('ethers');
require('dotenv').config();
const ADDRESSES = require('./constants');

const POOL_ABI = [
    {
        "inputs": [],
        "name": "slot0",
        "outputs": [
            {"internalType": "uint160", "name": "sqrtPriceX96", "type": "uint160"},
            {"internalType": "int24", "name": "tick", "type": "int24"},
            {"internalType": "uint16", "name": "observationIndex", "type": "uint16"},
            {"internalType": "uint16", "name": "observationCardinality", "type": "uint16"},
            {"internalType": "uint16", "name": "observationCardinalityNext", "type": "uint16"},
            {"internalType": "uint8", "name": "feeProtocol", "type": "uint8"},
            {"internalType": "bool", "name": "unlocked", "type": "bool"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "token0",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "token1",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    }
];

async function getTokenPrice(tokenAddress, poolAddress) {
    // Validate inputs
    if (!ethers.isAddress(tokenAddress) || !ethers.isAddress(poolAddress)) {
        throw new Error('Invalid token or pool address');
    }

    // Set up provider
    const provider = new ethers.JsonRpcProvider(ADDRESSES.RPC_URL, { chainId: ADDRESSES.CHAIN_ID, name: 'Sonic' });
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

    try {
        // Fetch pool data
        const slot0 = await pool.slot0();
        const sqrtPriceX96 = slot0.sqrtPriceX96;
        const token0 = await pool.token0();
        const token1 = await pool.token1();

        // Determine token order and decimals
        const usdcDecimals = 6; // USDC.e
        const tokenDecimals = tokenAddress.toLowerCase() === ADDRESSES.USDC.toLowerCase() ? 6 : 18; // Assume 18 for non-USDC tokens
        const isToken0USDC = token0.toLowerCase() === ADDRESSES.USDC.toLowerCase();
        const isTargetTokenUSDC = tokenAddress.toLowerCase() === ADDRESSES.USDC.toLowerCase();

        // Calculate price using BigInt for precision
        const sqrtPriceX96Big = BigInt(sqrtPriceX96);
        const priceRaw = (sqrtPriceX96Big * sqrtPriceX96Big) / (1n << 192n);

        let price;
        if (isTargetTokenUSDC) {
            // Price of USDC.e in USDC.e is 1
            price = 1.0;
        } else if (isToken0USDC) {
            // USDC.e is token0, token is token1: priceRaw is USDC.e/token
            price = Number(priceRaw) / 10 ** (tokenDecimals - usdcDecimals); // e.g., 10^(18-6) = 10^12
        } else {
            // Token is token0, USDC.e is token1: priceRaw is token/USDC.e, invert
            const priceRawInverted = (1n << 192n) / (sqrtPriceX96Big * sqrtPriceX96Big);
            price = Number(priceRawInverted) / 10 ** (usdcDecimals - tokenDecimals); // e.g., 10^(6-18) = 10^-12
        }

        return price;
    } catch (error) {
        console.error(`Error fetching price for token ${tokenAddress} in pool ${poolAddress}:`, error);
        throw error;
    }
}

module.exports = getTokenPrice;