const { ethers } = require('ethers');
require('dotenv').config();

const RPC_URL = process.env.RPC_URL;
const ODOS_ROUTER_ADDRESS = ethers.getAddress('0xac041df48df9791b0654f1dbbf2cc8450c5f2e9d');

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)'
];

// Placeholder ABI for Odos router (replace with actual ABI if available)
const ODOS_ROUTER_ABI = [
    {
        "inputs": [
            {"internalType": "uint256", "name": "amountIn", "type": "uint256"},
            {"internalType": "uint256", "name": "amountOutMin", "type": "uint256"},
            {"internalType": "address[]", "name": "path", "type": "address[]"},
            {"internalType": "address", "name": "to", "type": "address"}
        ],
        "name": "swapExactTokensForTokens",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

async function swapTokensOdos(tokenFrom, tokenTo, amountIn) {
    const walletAddress = ethers.getAddress(process.env.WALLET_ADDRESS);
    const privateKey = process.env.PRIVATE_KEY;

    if (!walletAddress || !privateKey) {
        throw new Error('WALLET_ADDRESS or PRIVATE_KEY environment variable is not set');
    }

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL, {
            chainId: 146,
            name: 'Sonic'
        });
        const signer = new ethers.Wallet(privateKey, provider);

        const normalizedTokenFrom = ethers.getAddress(tokenFrom);
        const normalizedTokenTo = ethers.getAddress(tokenTo);

        const tokenFromContract = new ethers.Contract(normalizedTokenFrom, ERC20_ABI, signer);
        const allowance = await tokenFromContract.allowance(walletAddress, ODOS_ROUTER_ADDRESS);

        if (BigInt(allowance) < BigInt(amountIn)) {
            const approveTx = await tokenFromContract.approve(ODOS_ROUTER_ADDRESS, amountIn);
            await approveTx.wait();
            console.log(`Approved ${ethers.formatUnits(amountIn, 18)} of tokenFrom for swapping through Odos`);
        }

        const odosRouter = new ethers.Contract(ODOS_ROUTER_ADDRESS, ODOS_ROUTER_ABI, signer);

        const path = [normalizedTokenFrom, normalizedTokenTo];
        const amountOutMin = ethers.parseUnits('0', 6); // Adjust based on tokenTo decimals

        const tx = await odosRouter.swapExactTokensForTokens(amountIn, amountOutMin, path, walletAddress);
        const receipt = await tx.wait();
        console.log(`Swap completed through Odos. Transaction hash: ${receipt.hash}`);

        return receipt;
    } catch (error) {
        console.error('Error swapping tokens through Odos:', error);
        throw error;
    }
}

module.exports = swapTokensOdos;