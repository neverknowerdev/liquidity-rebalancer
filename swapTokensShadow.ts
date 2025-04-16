import { ethers } from 'ethers';
import { ADDRESSES, toTokenName } from './constants';
import dotenv from 'dotenv';

dotenv.config();

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)'
];

const SWAP_ROUTER_ABI = [
    {
        inputs: [
            {
                components: [
                    { internalType: 'address', name: 'tokenIn', type: 'address' },
                    { internalType: 'address', name: 'tokenOut', type: 'address' },
                    { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
                    { internalType: 'address', name: 'recipient', type: 'address' },
                    { internalType: 'uint256', name: 'deadline', type: 'uint256' },
                    { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
                    { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
                    { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' }
                ],
                internalType: 'struct ISwapRouter.ExactInputSingleParams',
                name: 'params',
                type: 'tuple'
            }
        ],
        name: 'exactInputSingle',
        outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
        stateMutability: 'payable',
        type: 'function'
    }
];

async function swapTokensShadow(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    decimalsIn: number
): Promise<ethers.ContractReceipt> {
    const walletAddress = ethers.utils.getAddress(process.env.WALLET_ADDRESS || '');
    const privateKey = process.env.PRIVATE_KEY;

    if (!walletAddress || !privateKey) {
        throw new Error('WALLET_ADDRESS or PRIVATE_KEY not set');
    }

    const provider = new ethers.providers.JsonRpcProvider(ADDRESSES.RPC_URL, {
        chainId: ADDRESSES.CHAIN_ID,
        name: 'Sonic'
    });
    const signer = new ethers.Wallet(privateKey, provider);

    const tokenInContract = new ethers.Contract(tokenIn, ERC20_ABI, signer);
    const tokenInBalance = await tokenInContract.balanceOf(walletAddress);
    console.log(`Input token balance: ${ethers.utils.formatUnits(tokenInBalance, decimalsIn)} ${toTokenName(tokenIn)}`);
    if (BigInt(tokenInBalance) < amountIn) {
        throw new Error(`Insufficient balance: ${ethers.utils.formatUnits(tokenInBalance, decimalsIn)}`);
    }

    const sBalance = await provider.getBalance(walletAddress);
    const minSBalance = ethers.utils.parseUnits('0.01', 18);
    if (sBalance < minSBalance) {
        throw new Error(`Insufficient S balance: ${ethers.utils.formatUnits(sBalance, 18)} S`);
    }

    const allowance = await tokenInContract.allowance(walletAddress, ADDRESSES.SWAP_ROUTER);
    if (BigInt(allowance) < amountIn) {
        console.log(`Approving ${toTokenName(tokenIn)}...`);
        const approveTx = await tokenInContract.approve(ADDRESSES.SWAP_ROUTER, amountIn, { gasLimit: 100000 });
        await approveTx.wait();
    }

    const params = {
        tokenIn,
        tokenOut,
        tickSpacing: 100,
        recipient: walletAddress,
        deadline: Math.floor(Date.now() / 1000) + 1800,
        amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0
    };

    const swapRouter = new ethers.Contract(ADDRESSES.SWAP_ROUTER, SWAP_ROUTER_ABI, signer);
    console.log(`Swapping ${ethers.utils.formatUnits(amountIn, decimalsIn)} ${toTokenName(tokenIn)}...`);
    const tx = await swapRouter.exactInputSingle(params, { gasLimit: 300000 });
    const receipt = await tx.wait();
    console.log(`Swap completed. Tx hash: ${receipt.transactionHash}`);

    return receipt;
}

export default swapTokensShadow;