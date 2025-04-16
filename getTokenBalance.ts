import { ethers } from 'ethers';
import { ADDRESSES } from './constants';

const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)'
] as const;

async function getTokenBalance(tokenAddress: string, walletAddress: string): Promise<bigint> {
    if (!ethers.utils.isAddress(tokenAddress) || !ethers.utils.isAddress(walletAddress)) {
        throw new Error('Invalid tokenAddress or walletAddress');
    }

    const provider = new ethers.providers.JsonRpcProvider(ADDRESSES.RPC_URL, {
        chainId: ADDRESSES.CHAIN_ID,
        name: 'Sonic'
    });

    try {
        const normalizedAddress = ethers.utils.getAddress(tokenAddress);
        const contract = new ethers.Contract(normalizedAddress, ERC20_ABI, provider);
        const balance = await contract.balanceOf(walletAddress);
        return BigInt(balance); // Return raw balance as bigint
    } catch (error) {
        console.error(`Error fetching balance for token ${tokenAddress}:`, error);
        throw error;
    }
}

export default getTokenBalance;