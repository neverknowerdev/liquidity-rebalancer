const { ethers } = require('ethers');
const {ADDRESSES} = require('./constants');
const { Token, Pool } = require('@uniswap/v3-sdk');

const getTokenBalance = require('./getTokenBalance');
const swapTokensShadow = require('./swapTokensShadow');
const getOptimalAmounts = require('./getOptimalAmounts');
const {POOL_ABI, MANAGER_ABI, ERC20_ABI} = require('./abi');

require('dotenv').config();

async function manageLiquidityPosition(poolAddress) {
    const walletAddress = ethers.getAddress(process.env.WALLET_ADDRESS);
    const privateKey = process.env.PRIVATE_KEY;
    if (!walletAddress || !privateKey) {
        throw new Error('WALLET_ADDRESS or PRIVATE_KEY not set');
    }

    const provider = new ethers.JsonRpcProvider(ADDRESSES.RPC_URL, { chainId: ADDRESSES.CHAIN_ID, name: 'Sonic' });
    const signer = new ethers.Wallet(privateKey, provider);

    const poolContract = new ethers.Contract(
        poolAddress,
        POOL_ABI,
        provider
    );

    const [token0Address, token1Address, fee, liquidity, slot0] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.liquidity(),
        poolContract.slot0(),
    ]);

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, signer);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, signer);
    const token0Decimals = Number(await token0Contract.decimals());
    const token1Decimals = Number(await token1Contract.decimals());

    const token0 = new Token(ADDRESSES.CHAIN_ID, token0Address, token0Decimals);
    const token1 = new Token(ADDRESSES.CHAIN_ID, token1Address, token1Decimals);

    const poolName = `${await token0Contract.symbol()}/${await token1Contract.symbol()}`;


    const manager = new ethers.Contract(ADDRESSES.NONFUNGIBLE_POSITION_MANAGER, MANAGER_ABI, signer);

    const pool = new Pool(token0, token1, Number(fee), slot0.sqrtPriceX96.toString(), liquidity, Number(slot0.tick));


    try {
        // Get balances
        const balances = await getTokenBalance([ADDRESSES.USDC, ADDRESSES.X33, ADDRESSES.WS]);
        console.log(`\nManaging ${poolName} Pool`);
        console.log(`Initial balances for ${balances.address}:`);
        console.log(`- USDC.e: ${balances.balances['USDC.e'].balance} USDC.e`);
        console.log(`- x33: ${balances.balances['x33'].balance} x33`);
        console.log(`- wS: ${balances.balances['wS'].balance} wS`);
        console.log(`- S: ${balances.balances['S'].balance} S`);

        // Get poolContract state
        const currentTick = slot0.tick;
        const tickSpacing = await poolContract.tickSpacing();


        // Calculate price (USDC.e/x33)

        const isToken0USDC = token0.toLowerCase() === ADDRESSES.USDC.toLowerCase();
        const sqrtPriceX96 = slot0.sqrtPriceX96;

        let price;

        // Use BigInt to avoid precision loss
        const sqrtPriceX96Big = BigInt(sqrtPriceX96);
        const priceRaw = (sqrtPriceX96Big * sqrtPriceX96Big) / (1n << 192n);

        if (isToken0USDC) {
            // USDC.e is token0, x33 is token1: price is USDC.e/x33
            price = Number(priceRaw) / 10 ** Number(token1.decimals - token0.decimals); // Divide by 10^12
        } else {
            // x33 is token0, USDC.e is token1: price is x33/USDC.e, invert to USDC.e/x33
            const priceRawInverted = (1n << 192n) / (sqrtPriceX96Big * sqrtPriceX96Big);
            price = Number(priceRawInverted) / 10 ** (token0.decimals - token1.decimals); // Divide by 10^-12, i.e., multiply by 10^12
        }


        console.log(`${poolName} Pool State:`);
        console.log(`- Current Tick: ${currentTick}`);
        console.log(`- Price: ${price.toFixed(6)} USDC.e/${poolName}`);
        console.log(`- Token0: ${token0.name} (USDC.e)`);
        console.log(`- Token1: ${token1.name} (${poolName})`);
        console.log(`- Tick Spacing: ${tickSpacing}`);

        // Get current position
        const positionCount = await manager.balanceOf(walletAddress);
        console.log(`Total Position Count: ${positionCount}`);

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
                tokenId = tid;
                shouldMintNewPosition = false;
                break;
            }
        }

        if (!shouldMintNewPosition) {
            const position = await manager.positions(tokenId);
            const { tickLower, tickUpper, liquidity, tokensOwed0, tokensOwed1 } = position;
            console.log(`Position Found in ${poolName} Pool (Token ID: ${tokenId}):`);
            console.log(`- Tick Range: [${tickLower}, ${tickUpper}]`);
            console.log(`- Liquidity: ${ethers.formatUnits(liquidity, 0)} units`);
            console.log(`- Fees Owed: ${ethers.formatUnits(tokensOwed0, 6)} USDC.e, ${ethers.formatUnits(tokensOwed1, 18)} ${poolName}`);

            // Check if position is in range
            if (currentTick >= tickLower && currentTick <= tickUpper) {
                console.log(`Position is within price range for ${poolName} pool. No action needed.`);
                return false;
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
            console.log(`Liquidity decreased. Tx hash: ${decreaseReceipt.hash}`);

            const collectParams = {
                tokenId,
                recipient: walletAddress,
                amount0Max: ethers.parseUnits('1000000', 6),
                amount1Max: ethers.parseUnits('1000000', 18)
            };
            console.log('Collecting tokens and fees...');
            const collectTx = await manager.collect(collectParams, { gasLimit: 500000 });
            const collectReceipt = await collectTx.wait();
            console.log(`Tokens collected. Tx hash: ${collectReceipt.hash}`);

            console.log('Burning position NFT...');
            const burnTx = await manager.burn(tokenId, { gasLimit: 300000 });
            const burnReceipt = await burnTx.wait();
            console.log(`Position burned. Tx hash: ${burnReceipt.hash}`);

            shouldMintNewPosition = true;
        }

        if (shouldMintNewPosition) {
            console.log(`No position exists or position closed in ${poolName} pool. Preparing to mint new position...`);

            // Check balances and rebalance
            const balancesPostClose = await getTokenBalance([ADDRESSES.USDC, ADDRESSES.X33, ADDRESSES.WS]);
            const usdcBalance = balancesPostClose.balances['USDC.e'].balance;
            const token1Balance = balancesPostClose.balances[poolName].balance;
            console.log(`Current balances:`);
            console.log(`- USDC.e: ${usdcBalance} USDC.e`);
            console.log(`- ${poolName}: ${token1Balance} ${poolName}`);

            const usdcValue = Number(balancesPostClose.balances['USDC.e'].balance);
            const token1Amount = Number(balancesPostClose.balances[poolName].balance);
            let token1ValueInUSD;
            if (isToken0USDC) {
                // USDC.e is token0, price is USDC.e/x33, invert for x33/USDC.e
                token1ValueInUSD = token1Amount * (1 / price); // x33 amount * (x33/USDC.e)
            } else {
                // x33 is token0, price is USDC.e/x33
                token1ValueInUSD = token1Amount * price; // x33 amount * (USDC.e/x33)
            }

            console.log(`Values:`);
            console.log(`- USDC.e: $${usdcValue.toFixed(2)}`);
            console.log(`- ${poolName}: $${token1ValueInUSD.toFixed(2)}`);

            // Mint new position
            const tickRange = 100n;
            const adjustedTickLower = BigInt(currentTick) - (BigInt(currentTick) % tickRange);
            const adjustedTickUpper = adjustedTickLower + tickRange;
            console.log(`New tick range: [${adjustedTickLower}, ${adjustedTickUpper}], current tick = ${currentTick}`);

            console.log(`price ranges: [${GetPrice(adjustedTickLower, usdcDecimals, x33Decimals)}, ${GetPrice(adjustedTickUpper, usdcDecimals, x33Decimals)}], current price = ${GetPrice(currentTick, usdcDecimals, x33Decimals)}`);

            // console.log(usdcValue*10**Number(usdcDecimals),token1Amount * 10**Number(x33Decimals) );
            // const optimalAmountsResp = getOptimalAmountsForTokens(usdcValue*10**Number(usdcDecimals), token1Amount * 10**Number(x33Decimals), Number(currentTick), Number(adjustedTickLower), Number(adjustedTickUpper), Number(usdcDecimals), Number(x33Decimals));
            // // console.log(`optimal amount of USDC = ${Number(optimalAmountsResp.amountA)/10**6}`);
            // console.log(`optimal amount of USDC = ${optimalAmountsResp.amountA}`);
            // // console.log(`optimal amount of x33 = ${Number(optimalAmountsResp.amountB)/10**Number(x33Decimals)}`);
            // console.log(`optimal amount of x33 = ${optimalAmountsResp.amountB}`);

            const optimalAmounts = getOptimalAmounts(pool, usdcValue, token1Amount, Number(adjustedTickLower), Number(adjustedTickUpper));
            console.log('optimalAmounts', optimalAmounts);

            return;

            if(optimalAmounts.token0Amount > usdcValue) {
                console.log('buying more USDC.e..');

                const token1Delta = token1Amount - optimalAmounts.token1Amount;
                const token1DeltaUnits = ethers.parseUnits(token1Delta.toFixed(Number(x33Decimals)), Number(x33Decimals));
                await swapTokensShadow(token1.address, token0.address, token1DeltaUnits, x33Decimals);

            } else if(optimalAmounts.token1Amount > token1Amount) {
                console.log('buying more x33..');

                const token0Delta = usdcValue - optimalAmounts.token0Amount;
                const token1DeltaUnits = ethers.parseUnits(token0Delta.toFixed(Number(usdcDecimals)), Number(usdcDecimals));
                await swapTokensShadow(token0.address, token1.address, token1DeltaUnits, usdcDecimals);
            }

            // Refresh balances
            const finalBalances = await getTokenBalance([ADDRESSES.USDC, ADDRESSES.X33, ADDRESSES.WS]);
            const newUsdcBalance = ethers.parseUnits(finalBalances.balances['USDC.e'].balance, 6);
            const newToken1Balance = ethers.parseUnits(finalBalances.balances[poolName].balance, 18);


            const newToken1BalanceInUSD = finalBalances.balances[poolName].balance / price;
            console.log(`Post-swap balances:`);
            console.log(`- USDC.e: ${finalBalances.balances['USDC.e'].balance} USDC.e`);
            console.log(`- ${poolName}: ${finalBalances.balances[poolName].balance} ${poolName} (${newToken1BalanceInUSD} $)`);


            const allowanceUSDC = await token0Contract.allowance(walletAddress, ADDRESSES.NONFUNGIBLE_POSITION_MANAGER);
            const allowanceToken1 = await token1Contract.allowance(walletAddress, ADDRESSES.NONFUNGIBLE_POSITION_MANAGER);
            if (BigInt(allowanceUSDC) < BigInt(newUsdcBalance)) {
                await token0Contract.approve(ADDRESSES.NONFUNGIBLE_POSITION_MANAGER, newUsdcBalance, { gasLimit: 100000 });
                console.log(`Approved ${ethers.formatUnits(newUsdcBalance, 6)} USDC.e`);
            }
            if (BigInt(allowanceToken1) < BigInt(newToken1Balance)) {
                await token1Contract.approve(ADDRESSES.NONFUNGIBLE_POSITION_MANAGER, newToken1Balance, { gasLimit: 100000 });
                console.log(`Approved ${ethers.formatUnits(newToken1Balance, 18)} ${poolName}`);
            }

            const mintParams = {
                token0: token0.address,
                token1: token1.address,
                tickSpacing: tickSpacing,
                tickLower: adjustedTickLower,
                tickUpper: adjustedTickUpper,
                amount0Desired: newUsdcBalance,
                amount1Desired: newToken1Balance,
                amount0Min: newUsdcBalance * BigInt(90) / BigInt(100),
                amount1Min: newToken1Balance * BigInt(90) / BigInt(100),
                recipient: walletAddress,
                deadline: Math.floor(Date.now() / 1000) + 18000
            };
            console.log(`Minting new position for ${poolName} pool...`);
            const mintTx = await manager.mint(mintParams, { gasLimit: 1000000 });
            const mintReceipt = await mintTx.wait();
            console.log(`New position minted. Tx hash: ${mintReceipt.hash}`);
        }

        const finalSlot0 = await poolContract.slot0();
        console.log(`Final ${poolName} pool tick: ${finalSlot0.tick}`);
        return true;
    } catch (error) {
        console.error(`Error managing ${poolName} pool liquidity position:`, error);
        throw error;
    }
}

function GetPrice(tick, Decimal0, Decimal1) {
    let price0 = (1.0001**Number(tick))/(10**(Number(Decimal1-Decimal0)))
    let price1 = 1 / price0;
    return price1;
}


// function getOptimalAmounts(token0Amount, token1Amount, price, currentTick, lowerTick, upperTick) {
//     const token1AmountInToken0 = token1Amount / price;
//     const totalAmount = token0Amount + token1AmountInToken0;
//
//     const tickRange = upperTick - lowerTick;
//     const token0IdealAmountInToken0 = totalAmount * (upperTick - currentTick) / tickRange;
//     const token1IdealAmountInToken0 = totalAmount * (currentTick - lowerTick) / tickRange;
//
//     // re-verify
//     // liquidity0(token0Amount, )
//
//     return {
//         token0Amount: token0IdealAmountInToken0,
//         token1Amount: token1IdealAmountInToken0 * price
//     }
// }
// const q96 = BigInt(2) ** BigInt(96);
//
// function tickToSqrtPriceX96(tick) {
//     const base = 1.0001;
//     const exponent = tick / 2;
//     const sqrtPrice = Math.pow(base, exponent); // Note: May lose precision for large ticks
//     return BigInt(Math.floor(sqrtPrice * Number(q96)));
// }
//
// function getOptimalAmounts2(token0Amount, token1Amount, currentTick, lowerTick, upperTick, decimals0 = 6, decimals1 = 18) {
//     // Convert to BigInt for precision
//     const amount0 = BigInt(Math.floor(token0Amount * 10 ** decimals0)); // USDC.e
//     const amount1 = BigInt(Math.floor(token1Amount * 10 ** decimals1)); // x33
//
//     // Calculate sqrtPrices (simplified, may need better precision for large ticks)
//     const sqrtP_a = tickToSqrtPriceX96(lowerTick);
//     const sqrtP_b = tickToSqrtPriceX96(upperTick);
//     const sqrtP = tickToSqrtPriceX96(currentTick);
//
//     // Ensure current tick is in range for simplicity
//     if (currentTick < lowerTick || currentTick >= upperTick) {
//         throw new Error("Current tick must be within range for in-range position");
//     }
//
//     // Calculate L from each token (in-range case)
//     const q96Num = Number(q96);
//     const L_from0 = amount0 * BigInt(Math.floor(q96Num / Number(sqrtP) - q96Num / Number(sqrtP_a)));
//     const L_from1 = amount1 * BigInt(Math.floor(Number(sqrtP) - Number(sqrtP_a)));
//
//     // Take minimum L (simplified, actual implementation may need rounding)
//     const L = L_from0 < L_from1 ? L_from0 : L_from1; // Need to handle division properly
//
//     // Recalculate amounts (simplified, needs exact Uniswap V3 math)
//     const amount0Final = L * BigInt(Math.floor(q96Num / Number(sqrtP_a) - q96Num / Number(sqrtP)));
//     const amount1Final = L * BigInt(Math.floor(Number(sqrtP) - Number(sqrtP_a)));
//
//     // Convert back to decimal for output
//     return {
//         token0Amount: Number(amount0Final) / 10 ** decimals0,
//         token1Amount: Number(amount1Final) / 10 ** decimals1
//     };
// }

async function runWeb3Tasks() {
    try {
        const x33Handled = await manageLiquidityPosition(
            ADDRESSES.USDC_X33_POOL,
            ADDRESSES.USDC,
            ADDRESSES.X33,
            'x33'
        );
        // const wsHandled = await manageLiquidityPosition(
        //     ADDRESSES.USDC_WS_POOL,
        //     ADDRESSES.USDC,
        //     ADDRESSES.WS,
        //     'wS'
        // );
        console.log(`Position management completed: x33=${x33Handled}`);
    } catch (error) {
        console.error('Failed to execute web3 tasks:', error);
    }
}




runWeb3Tasks();