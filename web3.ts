import { ethers } from 'ethers';
import { Pool, Position } from '@uniswap/v4-sdk';
import { CurrencyAmount, Token } from '@uniswap/sdk-core';
import {ADDRESSES, toTokenName} from './constants';
import getTokenBalance from './getTokenBalance';
import swapTokensShadow from './swapTokensShadow';
import getOptimalAmounts from './getOptimalAmounts';
import { POOL_ABI, MANAGER_ABI, ERC20_ABI } from './abi';
import dotenv from 'dotenv';
import {getOptimalAmounts2} from "./getOptimalAmounts2";

dotenv.config();

interface Slot0 {
    sqrtPriceX96: bigint;
    tick: number;
    observationIndex: number;
    observationCardinality: number;
    observationCardinalityNext: number;
    feeProtocol: number;
    unlocked: boolean;
}

interface TokenBalanceInfo {
    address: string | null;
    balance: string;
    raw: string;
    decimals: number;
}

interface TokenBalance {
    address: string;
    balances: {
        [key: string]: TokenBalanceInfo;
    };
}

async function manageLiquidityPosition(poolAddress: string): Promise<boolean> {
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

    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);

    const [token0Address, token1Address, fee, liquidity, slot0]: [
        string,
        string,
        number,
        bigint,
        Slot0
    ] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.liquidity(),
        poolContract.slot0()
    ]);

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, signer);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, signer);
    const token0Decimals = Number(await token0Contract.decimals());
    const token1Decimals = Number(await token1Contract.decimals());

    const token0 = new Token(ADDRESSES.CHAIN_ID, token0Address, token0Decimals, await token0Contract.symbol());
    const token1 = new Token(ADDRESSES.CHAIN_ID, token1Address, token1Decimals, await token1Contract.symbol());

    const poolName = `${token0.symbol}/${token1.symbol}`;
    const tickSpacing = await poolContract.tickSpacing();

    const manager = new ethers.Contract(
        ADDRESSES.NONFUNGIBLE_POSITION_MANAGER,
        MANAGER_ABI,
        signer
    );

    const pool = new Pool(
        token0,
        token1,
        Number(fee),
        tickSpacing,
        walletAddress,
        slot0.sqrtPriceX96.toString(),
        liquidity.toString(),
        Number(slot0.tick)
    );

    try {
        // Get balances
        // const balanceS = await getTokenBalance(ADDRESSES.WS, walletAddress);
        // const token0Balance = await getTokenBalance(token0Address, walletAddress);
        // const token1Balance = await getTokenBalance(token1Address, walletAddress);

        console.log(`\nManaging ${poolName} Pool (${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })})`);
        // console.log(`Initial balances for ${walletAddress}:`);
        // console.log(`- ${formatMoney(balanceS, 18)} wS`);
        // console.log(`- ${formatMoney(token0Balance, token0.decimals)} ${token0.symbol}`);
        // console.log(`- ${formatMoney(token1Balance, token1.decimals)} ${token1.symbol}`);

        // Get poolContract state
        const currentTick = slot0.tick;

        // Calculate price (USDC.e/x33)
        const isToken0USDC = token0.address.toLowerCase() === ADDRESSES.USDC.toLowerCase();
        const sqrtPriceX96 = slot0.sqrtPriceX96;

        let price: number;
        const sqrtPriceX96Big = BigInt(sqrtPriceX96);
        const priceRaw = (sqrtPriceX96Big * sqrtPriceX96Big) / (BigInt(1) << BigInt(192));

        if (isToken0USDC) {
            price = Number(priceRaw) / 10 ** (token1Decimals - token0Decimals);
        } else {
            const priceRawInverted = (BigInt(1) << BigInt(192)) / (sqrtPriceX96Big * sqrtPriceX96Big);
            price = Number(priceRawInverted) / 10 ** (token0Decimals - token1Decimals);
        }

        // console.log(`${poolName} Pool State:`);
        // console.log(`- Current Tick: ${currentTick}`);
        // console.log(`- Price: ${price.toFixed(6)} ${poolName}`);
        // console.log(`- Token0: ${token0.symbol}`);
        // console.log(`- Token1: ${token1.symbol}`);
        // console.log(`- Tick Spacing: ${tickSpacing}`);

        // Get current position
        const positionCount = Number(await manager.balanceOf(walletAddress));
        // console.log(`Total Position Count: ${positionCount}`);

        let shouldMintNewPosition = true;
        let tokenId = 0;

        // Check all positions for this poolContract
        for (let i = 0; i < positionCount; i++) {
            const tid = await manager.tokenOfOwnerByIndex(walletAddress, i);
            const position = await manager.positions(tid);
            if (
                position.token0.toLowerCase() === token0.address.toLowerCase() &&
                position.token1.toLowerCase() === token1.address.toLowerCase()
            ) {
                tokenId = Number(tid);
                shouldMintNewPosition = false;
                break;
            }
        }

        if (!shouldMintNewPosition) {
            const position = await manager.positions(tokenId);
            const { tickLower, tickUpper, liquidity, tokensOwed0, tokensOwed1 } = position;
            console.log(`Position Found in ${poolName} Pool (Token ID: ${tokenId}):`);
            console.log(`- Tick Range: [${tickLower}, ${tickUpper}], currentTick = ${currentTick}`);
            console.log(`- Liquidity: ${ethers.utils.formatUnits(liquidity, 0)} units`);
            console.log(
                `- Fees Owed: ${ethers.utils.formatUnits(tokensOwed0, 6)} USDC.e, ${ethers.utils.formatUnits(
                    tokensOwed1,
                    18
                )} ${poolName}`
            );

            // Check if position is in range
            if (currentTick >= tickLower && currentTick <= tickUpper) {
                if(currentTick - tickLower > 5n && tickUpper - currentTick > 5n) {
                    console.log(`Position is within price range for ${poolName} pool. No action needed.`);
                    return false;
                }
            }

            console.log(`Position is out of range for ${poolName} pool. Closing position...`);

            // Close position
            const decreaseParams = {
                tokenId,
                liquidity,
                amount0Min: 0,
                amount1Min: 0,
                deadline: Math.floor(Date.now() / 1000) + 1800
            };
            console.log('Decreasing liquidity...');
            const decreaseTx = await manager.decreaseLiquidity(decreaseParams, { gasLimit: 500000 });
            const decreaseReceipt = await decreaseTx.wait();
            console.log(`Liquidity decreased. Tx hash: ${decreaseReceipt.transactionHash}`);

            const collectParams = {
                tokenId,
                recipient: walletAddress,
                amount0Max: ethers.utils.parseUnits('1000000', token0Decimals),
                amount1Max: ethers.utils.parseUnits('1000000', token1Decimals)
            };
            console.log('Collecting tokens and fees...');
            const collectTx = await manager.collect(collectParams, { gasLimit: 500000 });
            const collectReceipt = await collectTx.wait();
            console.log(`Tokens collected. Tx hash: ${collectReceipt.transactionHash}`);

            console.log('Burning position NFT...');
            const burnTx = await manager.burn(tokenId, { gasLimit: 300000 });
            const burnReceipt = await burnTx.wait();
            console.log(`Position burned. Tx hash: ${burnReceipt.transactionHash}`);

            shouldMintNewPosition = true;
        }

        if (shouldMintNewPosition) {
            console.log(`No position exists or position closed in ${poolName} pool. Preparing to mint new position...`);

            const token0Balance = await getTokenBalance(token0Address, walletAddress);
            const token1Balance = await getTokenBalance(token1Address, walletAddress);

            const token0Value = Number(ethers.utils.formatUnits(token0Balance, token0Decimals));
            const token1ValueInToken0 = Number(ethers.utils.formatUnits(token1Balance, token1Decimals)) / price;

            console.log(`Values:`);
            console.log(`total value: ${Number(token0Value+token1ValueInToken0).toFixed(2)} ${token0.symbol}`);
            console.log(`- ${token0.symbol}: ${Number(formatMoney(token0Balance, token0Decimals))}$`);
            console.log(`- ${token1.symbol}: ${Number(Number(ethers.utils.formatUnits(token1Balance, token1Decimals)) / price).toFixed(2)}$`);

            // Mint new position
            const tickRange = 1000n;
            let adjustedTickLower = (BigInt(currentTick) - tickRange/2n) / BigInt(tickSpacing) * BigInt(tickSpacing);
            let adjustedTickUpper = (BigInt(currentTick) + tickRange/2n) / BigInt(tickSpacing) * BigInt(tickSpacing);
            // if(BigInt(currentTick) - adjustedTickLower < 10n) {
            //     adjustedTickLower -= tickRange;
            // } else if (adjustedTickUpper - BigInt(currentTick) < 10n) {
            //     adjustedTickUpper += tickRange;
            // }
            // const adjustedTickLower = ((BigInt(currentTick) - tickRange) / BigInt(tickSpacing)) * BigInt(tickSpacing);
            // const adjustedTickUpper = ((BigInt(currentTick) + tickRange) / BigInt(tickSpacing)) * BigInt(tickSpacing);

            console.log(`New tick range: [${adjustedTickLower}, ${adjustedTickUpper}], current tick = ${currentTick}`);

            const optimalAmounts = await getOptimalAmounts(
                pool,
                price,
                Number(token0Balance),
                Number(token1Balance),
                Number(adjustedTickLower),
                Number(adjustedTickUpper),
                0.01
            );
            console.log('optimalAmounts', optimalAmounts);

            if(token1Balance > optimalAmounts.token1Amount) {
                const token1Delta = token1Balance - optimalAmounts.token1Amount;
                console.log(`swapping ${Number(token1Delta) / 10 ** token1Decimals} ${token1.symbol} to ${token0.symbol}..`);

                // return false;
                await swapTokensShadow(token1.address, token0.address, token1Delta, token1Decimals);
            } else if(token0Balance > optimalAmounts.token0Amount) {
                const token0Delta = token0Balance - optimalAmounts.token0Amount;

                console.log(`swapping ${Number(token0Delta) / 10 ** token0Decimals} ${token0.symbol} to ${token1.symbol}..`);

                // return false;
                await swapTokensShadow(token0.address, token1.address, token0Delta, token0Decimals);
            }

            // Refresh balances
            const token0BalanceFinal = await getTokenBalance(token0Address, walletAddress);
            const token1BalanceFinal = await getTokenBalance(token1Address, walletAddress);

            const token0BalanceFinalFormatted = ethers.utils.formatUnits(token0BalanceFinal, token0Decimals);
            const token1BalanceFinalFormatted = ethers.utils.formatUnits(token1BalanceFinal, token1Decimals);

            const newToken1BalanceInUSD = Number(token1BalanceFinalFormatted) / price;
            console.log(`Post-swap balances:`);
            console.log(`- ${token0.symbol}: ${formatMoney(token0BalanceFinal, token0Decimals)}`);
            console.log(`- ${token1.symbol}: ${formatMoney(token1BalanceFinal, token1Decimals)} (${newToken1BalanceInUSD} $)`);

            const allowanceUSDC = await token0Contract.allowance(walletAddress, ADDRESSES.NONFUNGIBLE_POSITION_MANAGER);
            const allowanceToken1 = await token1Contract.allowance(
                walletAddress,
                ADDRESSES.NONFUNGIBLE_POSITION_MANAGER
            );
            if (BigInt(allowanceUSDC) < BigInt(token0BalanceFinal)) {
                await token0Contract.approve(ADDRESSES.NONFUNGIBLE_POSITION_MANAGER, token0BalanceFinal, {
                    gasLimit: 100000
                });
                console.log(`Approved ${token0BalanceFinalFormatted} ${token0.symbol}`);
            }
            if (BigInt(allowanceToken1) < BigInt(token1BalanceFinal)) {
                await token1Contract.approve(ADDRESSES.NONFUNGIBLE_POSITION_MANAGER, token1BalanceFinal, {
                    gasLimit: 100000
                });
                console.log(`Approved ${token1BalanceFinalFormatted} ${token1.symbol}`);
            }

            const mintParams = {
                token0: token0.address,
                token1: token1.address,
                tickSpacing,
                tickLower: Number(adjustedTickLower),
                tickUpper: Number(adjustedTickUpper),
                amount0Desired: token0BalanceFinal,
                amount1Desired: token1BalanceFinal,
                amount0Min: token0BalanceFinal / 2n,
                amount1Min: token1BalanceFinal / 2n,
                recipient: walletAddress,
                deadline: Math.floor(Date.now() / 1000) + 18000
            };

            for(let i= 0; i<5; i++) {
                try {
                    console.log(`Minting new position for ${poolName} pool... trying ${i+1}`);
                    const mintTx = await manager.mint(mintParams, {gasLimit: 1000000});
                    const mintReceipt = await mintTx.wait();
                    console.log(`New position minted. Tx hash: ${mintReceipt.transactionHash}`);

                    break;
                } catch (error: any) {
                    // Check for specific error details
                    console.log(`minting tx error ${error.code}: "${error.message}".. `);
                }
            }

        }

        const finalSlot0 = await poolContract.slot0();
        console.log(`Final ${poolName} pool tick: ${finalSlot0.tick}`);
        return true;
    } catch (error) {
        console.error(`Error managing ${poolName} pool liquidity position:`, error);
        throw error;
    }
}

async function runWeb3Tasks(): Promise<void> {
    try {
        const x33Handled = await manageLiquidityPosition(ADDRESSES.USDC_X33_POOL);
        console.log(`Position management completed: x33=${x33Handled}`);
    } catch (error) {
        console.error('Failed to execute web3 tasks:', error);
    }
}

function formatMoney(amount: bigint, decimals: Number | bigint): string {
    return Number(ethers.utils.formatUnits(amount, Number(decimals))).toFixed(2);
}

runWeb3Tasks();