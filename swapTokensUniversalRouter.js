const { ethers } = require('ethers');
require('dotenv').config();

const RPC_URL = process.env.RPC_URL;
const UNIVERSAL_ROUTER_ADDRESS = ethers.getAddress('0x92643Dc4F75C374b689774160CDea09A0704a9c2');

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)'
];

const UNIVERSAL_ROUTER_ABI = [
  {
    "inputs": [
      {"internalType": "bytes", "name": "commands", "type": "bytes"},
      {"internalType": "bytes[]", "name": "inputs", "type": "bytes[]"},
      {"internalType": "uint256", "name": "deadline", "type": "uint256"}
    ],
    "name": "execute",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

async function swapTokensUniversal(tokenIn, tokenOut, amountIn) {
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

    // Check native S balance for gas
    const sBalance = await provider.getBalance(walletAddress);
    const minSBalance = ethers.parseUnits('0.01', 18);
    if (sBalance < minSBalance) {
      throw new Error(`Insufficient S balance: ${ethers.formatUnits(sBalance, 18)} S. Need at least 0.01 S for gas.`);
    }

    // Check tokenIn balance
    const tokenInContract = new ethers.Contract(tokenIn, ERC20_ABI, signer);
    const tokenInBalance = await tokenInContract.balanceOf(walletAddress);
    if (BigInt(tokenInBalance) < BigInt(amountIn)) {
      throw new Error(`Insufficient ${tokenIn} balance: ${ethers.formatUnits(tokenInBalance, 18)}. Need ${ethers.formatUnits(amountIn, 18)}.`);
    }

    const normalizedTokenIn = ethers.getAddress(tokenIn);
    const normalizedTokenOut = ethers.getAddress(tokenOut);

    // Approve tokens
    const allowance = await tokenInContract.allowance(walletAddress, UNIVERSAL_ROUTER_ADDRESS);
    if (BigInt(allowance) < BigInt(amountIn)) {
      const approveTx = await tokenInContract.approve(UNIVERSAL_ROUTER_ADDRESS, amountIn);
      await approveTx.wait();
      console.log(`Approved ${ethers.formatUnits(amountIn, 18)} of ${normalizedTokenIn} for Universal Router swap`);
    }

    // Encode V3_SWAP_EXACT_IN parameters
    const feeTier = 1500; // 0.15% fee tier for wS/USDC.e pool
    const amountOutMinimum = ethers.parseUnits('0', 6); // Adjust for production
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now

    const tokenInBytes = ethers.getBytes(normalizedTokenIn);
    const feeBytes = ethers.toBeArray(feeTier, 3);
    const tokenOutBytes = ethers.getBytes(normalizedTokenOut);
    const path = ethers.concat([tokenInBytes, feeBytes, tokenOutBytes]);

    const v3SwapInput = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256', 'uint256', 'bytes', 'bool'],
        [walletAddress, amountIn, amountOutMinimum, path, true]
    );

    // Set commands and inputs
    const commands = '0x0b'; // V3_SWAP_EXACT_IN
    const inputs = [v3SwapInput];

    // Execute swap
    const router = new ethers.Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, signer);
    console.log(`Swapping ${ethers.formatUnits(amountIn, 18)} of ${normalizedTokenIn} for ${normalizedTokenOut} via Universal Router (V3)...`);
    const tx = await router.execute(commands, inputs, deadline, {
      gasLimit: 300000,
      value: 0
    });
    const receipt = await tx.wait();
    console.log(`Universal Router V3 swap completed. Transaction hash: ${receipt.hash}`);

    return receipt;
  } catch (error) {
    console.error('Error swapping tokens via Universal Router (V3):', error);
    throw error;
  }
}

module.exports = swapTokensUniversal;