const { ethers } = require('ethers');
require('dotenv').config();
const {ADDRESSES} = require('./constants');

const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)'
];

async function getTokenBalance(tokenAddresses = [ADDRESSES.USDC, ADDRESSES.X33, ADDRESSES.WS]) {
    const walletAddress = ethers.getAddress(process.env.WALLET_ADDRESS);
    if (!walletAddress) {
        throw new Error('WALLET_ADDRESS not set in .env');
    }

    const provider = new ethers.JsonRpcProvider(ADDRESSES.RPC_URL, { chainId: ADDRESSES.CHAIN_ID, name: 'Sonic' });

    try {
        const result = {
            address: walletAddress,
            balances: {}
        };

        const balancePromises = tokenAddresses.map(async (tokenAddress) => {
            const normalizedAddress = ethers.getAddress(tokenAddress);
            const contract = new ethers.Contract(normalizedAddress, ERC20_ABI, provider);
            const balance = await contract.balanceOf(walletAddress);

            let decimals, tokenName;
            switch (normalizedAddress.toLowerCase()) {
                case ADDRESSES.USDC.toLowerCase():
                    decimals = 6;
                    tokenName = 'USDC.e';
                    break;
                case ADDRESSES.X33.toLowerCase():
                    decimals = 18;
                    tokenName = 'x33';
                    break;
                case ADDRESSES.WS.toLowerCase():
                    decimals = 18;
                    tokenName = 'wS';
                    break;
                default:
                    decimals = 18;
                    tokenName = normalizedAddress;
                    break;
            }

            return { tokenAddress: normalizedAddress, balance, decimals, tokenName };
        });

        const sBalancePromise = provider.getBalance(walletAddress);

        const [tokenResults, sBalance] = await Promise.all([
            Promise.all(balancePromises),
            sBalancePromise
        ]);

        tokenResults.forEach(({ tokenAddress, balance, decimals, tokenName }) => {
            result.balances[tokenName] = {
                address: tokenAddress,
                balance: ethers.formatUnits(balance, decimals),
                raw: balance.toString(),
                decimals
            };
        });

        result.balances['S'] = {
            address: null,
            balance: ethers.formatUnits(sBalance, 18),
            raw: sBalance.toString(),
            decimals: 18
        };

        return result;
    } catch (error) {
        console.error('Error fetching token balances:', error);
        throw error;
    }
}

module.exports = getTokenBalance;