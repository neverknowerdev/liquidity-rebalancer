"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const constants_1 = require("./constants");
const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)'
];
async function getTokenBalance(tokenAddress, walletAddress) {
    if (!ethers_1.ethers.utils.isAddress(tokenAddress) || !ethers_1.ethers.utils.isAddress(walletAddress)) {
        throw new Error('Invalid tokenAddress or walletAddress');
    }
    const provider = new ethers_1.ethers.providers.JsonRpcProvider(constants_1.ADDRESSES.RPC_URL, {
        chainId: constants_1.ADDRESSES.CHAIN_ID,
        name: 'Sonic'
    });
    try {
        const normalizedAddress = ethers_1.ethers.utils.getAddress(tokenAddress);
        const contract = new ethers_1.ethers.Contract(normalizedAddress, ERC20_ABI, provider);
        const balance = await contract.balanceOf(walletAddress);
        return BigInt(balance); // Return raw balance as bigint
    }
    catch (error) {
        console.error(`Error fetching balance for token ${tokenAddress}:`, error);
        throw error;
    }
}
exports.default = getTokenBalance;
