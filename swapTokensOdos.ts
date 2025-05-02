import axios, { AxiosResponse } from 'axios';
import {ADDRESSES, toTokenName} from "./constants";
import {TransactionReceipt, TransactionResponse} from "@ethersproject/abstract-provider";
import {ethers} from "ethers";
import {ERC20_ABI} from "./abi";
import {Token} from "@uniswap/sdk-core";

// Define interfaces for request and response structures
interface TokenAmount {
    tokenAddress: string;
    amount: string; // Fixed precision string (e.g., '1000000000000000000' for 1 token with 18 decimals)
}

interface OutputToken {
    tokenAddress: string;
    proportion: number; // Proportion of output, must sum to 1
}

export interface QuoteRequest {
    chainId: number; // e.g., 1 for Ethereum
    inputTokens: TokenAmount[];
    outputTokens: OutputToken[];
    slippageLimitPercent?: number; // e.g., 0.3 for 0.3%
    userAddr: string; // Checksummed user address
    referralCode?: string; // Optional, defaults to 0
    disableRFQs?: boolean; // Optional, defaults to true
    compact?: boolean; // Optional, defaults to true
}

interface AssembleRequest {
    userAddr: string;
    pathId: string;
    simulate: boolean; // false for actual transaction, true for gas estimation
}

interface Simulation {
    isSuccess: boolean;
    amountsOut: number[];
    gasEstimate: number;
    simulationError: {
        type: string;
        errorMessage: string;
    };
}

interface AssembleResponse {
    deprecated: string;
    traceId: string;
    blockNumber: number;
    gasEstimate: number;
    gasEstimateValue: number;
    inputTokens: TokenAmount[];
    outputTokens: TokenAmount[];
    netOutValue: number;
    outValues: string[];
    transaction: Transaction;
    simulation: Simulation;
}

interface Transaction {
    gas: number;
    gasPrice: number;
    value: string;
    to: string;
    from: string;
    data: string;
    nonce: number;
    chainId: number;
}

// Odos API base URL
const ODOS_API_URL = 'https://api.odos.xyz';


// Define the response structure based on the provided example
interface QuoteResponse {
    deprecated: string;
    traceId: string;
    inTokens: string[];
    outTokens: string[];
    inAmounts: string[];
    outAmounts: string[];
    gasEstimate: number;
    dataGasEstimate: number;
    gweiPerGas: number;
    gasEstimateValue: number;
    inValues: number[];
    outValues: number[];
    netOutValue: number;
    priceImpact: number;
    percentDiff: number;
    partnerFeePercent: number;
    pathId: string;
    pathViz: { [key: string]: any }; // Flexible object for path visualization
    pathVizImage: string;
    blockNumber: number;
}

// Define the quote function
export async function quote(request: QuoteRequest): Promise<QuoteResponse> {
    // Make the POST request to the Odos API
    try {
        const response = await axios.post<QuoteResponse>('https://api.odos.xyz/sor/quote/v2', request);
        return response.data as QuoteResponse;
    } catch (error) {
        console.error('Error fetching quote:', error);
        throw error; // Rethrow for caller to handle
    }
}

export async function estimateSwap(tokenInAddress: string, tokenInAmount: bigint, tokenOutAddress: string): Promise<QuoteResponse> {
    const req: QuoteRequest = {
        chainId: ADDRESSES.CHAIN_ID,
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
        userAddr: process.env.WALLET_ADDRESS as string, // Replace with actual user address
    };
    return await quote(req);
}

// Function to assemble the transaction
async function assembleTransaction(request: AssembleRequest): Promise<AssembleResponse> {
    const response: AxiosResponse<AssembleResponse> = await axios.post(`${ODOS_API_URL}/sor/assemble`, request);
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

export async function getTransactionDataByPathId(userAddr: string, pathId: string, simulate: boolean): Promise<Transaction> {
    const assembleRequest: AssembleRequest = {
        userAddr,
        pathId,
        simulate,
    };
    const assembleResponse = await assembleTransaction(assembleRequest);

    return assembleResponse.transaction;
}

export async function swapTokensOdos(walletAddress: string, tokenIn: Token, tokenInAmount: bigint, tokenOutAddress: string, maxFee: number, simulate: boolean): Promise<TransactionReceipt|null> {
    const estimateResp = await estimateSwap(tokenIn.address, tokenInAmount, tokenOutAddress);
    if(estimateResp.percentDiff < maxFee*-1) {
        console.log(`exchange percentageDiff is too bad ${estimateResp.percentDiff}, exiting..`)
        return null;
    }
    console.log('estimate swap fee diff %', estimateResp.percentDiff);


    const provider = new ethers.providers.JsonRpcProvider(ADDRESSES.RPC_URL, {
        chainId: ADDRESSES.CHAIN_ID,
        name: 'Sonic'
    });
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY as string, provider);

    const tokenInContract = new ethers.Contract(tokenIn.address, ERC20_ABI, signer);
    const tokenInBalance = await tokenInContract.balanceOf(walletAddress);
    console.log(`Input token balance: ${ethers.utils.formatUnits(tokenInBalance, tokenIn.decimals)} ${tokenIn.symbol}`);
    if (BigInt(tokenInBalance) < tokenInAmount) {
        throw new Error(`Insufficient balance: ${ethers.utils.formatUnits(tokenInBalance, tokenIn.decimals)}`);
    }

    const sBalance = await provider.getBalance(walletAddress);
    const minSBalance = ethers.utils.parseUnits('0.01', 18);
    if (sBalance < minSBalance) {
        throw new Error(`Insufficient S balance: ${ethers.utils.formatUnits(sBalance, 18)} S`);
    }

    const txData = await getTransactionDataByPathId(walletAddress, estimateResp.pathId, simulate);
    let txNonce = txData.nonce;

    const allowance = await tokenInContract.allowance(walletAddress, ADDRESSES.SWAP_ROUTER);
    if (BigInt(allowance) < tokenInAmount) {
        console.log(`Approving ${tokenIn.symbol}...`);
        const approveTx = await tokenInContract.approve(txData.to, tokenInAmount, {gasLimit: 100000});
        await approveTx.wait();

        txNonce++;
    }

    const transaction: ethers.providers.TransactionRequest = {
        to: txData.to,
        from: txData.from,
        nonce: txNonce,
        gasLimit: ethers.BigNumber.from(txData.gas),
        gasPrice: ethers.BigNumber.from(txData.gasPrice),
        value: ethers.BigNumber.from(txData.value),
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