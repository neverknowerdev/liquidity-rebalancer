"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.quote = quote;
exports.estimateSwap = estimateSwap;
exports.getTransactionDataByPathId = getTransactionDataByPathId;
exports.swapTokensOdos = swapTokensOdos;
const axios_1 = __importDefault(require("axios"));
const constants_1 = require("./constants");
const ethers_1 = require("ethers");
const abi_1 = require("./abi");
// Odos API base URL
const ODOS_API_URL = 'https://api.odos.xyz';
// Define the quote function
async function quote(request) {
    // Make the POST request to the Odos API
    try {
        const response = await axios_1.default.post('https://api.odos.xyz/sor/quote/v2', request);
        return response.data;
    }
    catch (error) {
        console.error('Error fetching quote:', error);
        throw error; // Rethrow for caller to handle
    }
}
async function estimateSwap(tokenInAddress, tokenInAmount, tokenOutAddress) {
    const req = {
        chainId: constants_1.ADDRESSES.CHAIN_ID,
        inputTokens: [
            {
                tokenAddress: tokenInAddress,
                amount: tokenInAmount.toString(), // Convert to fixed precision (e.g., 18 decimals)
            },
        ],
        outputTokens: [
            {
                tokenAddress: tokenOutAddress,
                proportion: 1,
            },
        ],
        slippageLimitPercent: 0.3,
        userAddr: process.env.WALLET_ADDRESS, // Replace with actual user address
    };
    return await quote(req);
}
// Function to assemble the transaction
async function assembleTransaction(request) {
    const response = await axios_1.default.post(`${ODOS_API_URL}/sor/assemble`, request);
    return response.data;
}
// Function to estimate how many token1 you'll receive
// export async function estimateOutput(
//     chainId: number,
//     inputTokenAddress: string,
//     inputAmount: string,
//     outputTokenAddress: string,
//     slippageLimitPercent: number,
//     userAddr: string
// ): Promise<string> {
//     const request: QuoteRequest = {
//         chainId,
//         inputTokens: [{ tokenAddress: inputTokenAddress, amount: inputAmount }],
//         outputTokens: [{ tokenAddress: outputTokenAddress, proportion: 1 }],
//         slippageLimitPercent,
//         userAddr,
//     };
//     const quote = await quote(request);
//     // Since there is only one output token, return the first (and only) output amount
//     return quote.outputAmounts[0];
// }
async function getTransactionDataByPathId(userAddr, pathId, simulate) {
    const assembleRequest = {
        userAddr,
        pathId,
        simulate,
    };
    const assembleResponse = await assembleTransaction(assembleRequest);
    return assembleResponse.transaction;
}
async function swapTokensOdos(walletAddress, tokenIn, tokenInAmount, tokenOutAddress, maxFee, simulate) {
    const estimateResp = await estimateSwap(tokenIn.address, tokenInAmount, tokenOutAddress);
    if (estimateResp.percentDiff < maxFee * -1) {
        console.log(`exchange percentageDiff is too bad ${estimateResp.percentDiff}, exiting..`);
        return null;
    }
    console.log('estimate swap fee diff %', estimateResp.percentDiff);
    const provider = new ethers_1.ethers.providers.JsonRpcProvider(constants_1.ADDRESSES.RPC_URL, {
        chainId: constants_1.ADDRESSES.CHAIN_ID,
        name: 'Sonic'
    });
    const signer = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const tokenInContract = new ethers_1.ethers.Contract(tokenIn.address, abi_1.ERC20_ABI, signer);
    const tokenInBalance = await tokenInContract.balanceOf(walletAddress);
    console.log(`Input token balance: ${ethers_1.ethers.utils.formatUnits(tokenInBalance, tokenIn.decimals)} ${tokenIn.symbol}`);
    if (BigInt(tokenInBalance) < tokenInAmount) {
        throw new Error(`Insufficient balance: ${ethers_1.ethers.utils.formatUnits(tokenInBalance, tokenIn.decimals)}`);
    }
    const sBalance = await provider.getBalance(walletAddress);
    const minSBalance = ethers_1.ethers.utils.parseUnits('0.01', 18);
    if (sBalance < minSBalance) {
        throw new Error(`Insufficient S balance: ${ethers_1.ethers.utils.formatUnits(sBalance, 18)} S`);
    }
    const txData = await getTransactionDataByPathId(walletAddress, estimateResp.pathId, simulate);
    let txNonce = txData.nonce;
    const allowance = await tokenInContract.allowance(walletAddress, constants_1.ADDRESSES.SWAP_ROUTER);
    if (BigInt(allowance) < tokenInAmount) {
        console.log(`Approving ${tokenIn.symbol}...`);
        const approveTx = await tokenInContract.approve(txData.to, tokenInAmount, { gasLimit: 100000 });
        await approveTx.wait();
        txNonce++;
    }
    const transaction = {
        to: txData.to,
        from: txData.from,
        nonce: txNonce,
        gasLimit: ethers_1.ethers.BigNumber.from(txData.gas),
        gasPrice: ethers_1.ethers.BigNumber.from(txData.gasPrice),
        value: ethers_1.ethers.BigNumber.from(txData.value),
        data: txData.data,
        chainId: txData.chainId,
    };
    const signedTx = await signer.signTransaction(transaction);
    const tx = await provider.sendTransaction(signedTx);
    return tx.wait();
}
/*
chainId: number; // e.g., 1 for Ethereum
    inputTokens: TokenAmount[];
    outputTokens: OutputToken[];
    slippageLimitPercent: number; // e.g., 0.3 for 0.3%
    userAddr: string; // Checksummed user address
 */
// const resp = await quote({
//      chainId: ADDRESSES.CHAIN_ID,
//     inputTokens: []Toke
// });
// Example usage:
// const chainId = 1; // Ethereum
// const inputTokenAddress = '0x...'; // Address of token0
// const inputAmount = '1000000000000000000'; // Amount of token0 (e.g., 1 token with 18 decimals)
// const outputTokenAddress = '0x...'; // Address of token1
// const slippageLimitPercent = 0.3; // 0.3% slippage tolerance
// const userAddr = '0x...'; // Your checksummed Ethereum address
//
// // Estimate output
// const estimatedOutput = await estimateOutput(chainId, inputTokenAddress, inputAmount, outputTokenAddress, slippageLimitPercent, userAddr);
// console.log('Estimated output:', estimatedOutput);
//
// // Get transaction data for exchange
// const transaction = await getExchangeTransaction(chainId, inputTokenAddress, inputAmount, outputTokenAddress, slippageLimitPercent, userAddr);
// console.log('Transaction to:', transaction.to);
// console.log('Transaction data:', transaction.data);
