"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const v4_sdk_1 = require("@uniswap/v4-sdk");
const sdk_core_1 = require("@uniswap/sdk-core");
const constants_1 = require("./constants");
const getTokenBalance_1 = __importDefault(require("./getTokenBalance"));
const getOptimalAmounts_1 = __importDefault(require("./getOptimalAmounts"));
const abi_1 = require("./abi");
const dotenv_1 = __importDefault(require("dotenv"));
const swapTokensOdos_1 = require("./swapTokensOdos");
const jsbi_1 = __importDefault(require("jsbi"));
dotenv_1.default.config();
async function manageLiquidityPosition(poolAddress, tickRange, tickMarginToReenter) {
    const walletAddress = ethers_1.ethers.utils.getAddress(process.env.WALLET_ADDRESS || '');
    const privateKey = process.env.PRIVATE_KEY;
    if (!walletAddress || !privateKey) {
        throw new Error('WALLET_ADDRESS or PRIVATE_KEY not set');
    }
    const provider = new ethers_1.ethers.providers.JsonRpcProvider(constants_1.ADDRESSES.RPC_URL, {
        chainId: constants_1.ADDRESSES.CHAIN_ID,
        name: 'Sonic'
    });
    const signer = new ethers_1.ethers.Wallet(privateKey, provider);
    const poolContract = new ethers_1.ethers.Contract(poolAddress, abi_1.POOL_ABI, provider);
    const [token0Address, token1Address, fee, liquidity, slot0] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.liquidity(),
        poolContract.slot0()
    ]);
    const feeNumber = fee / 10000;
    const token0Contract = new ethers_1.ethers.Contract(token0Address, abi_1.ERC20_ABI, signer);
    const token1Contract = new ethers_1.ethers.Contract(token1Address, abi_1.ERC20_ABI, signer);
    const token0Decimals = Number(await token0Contract.decimals());
    const token1Decimals = Number(await token1Contract.decimals());
    const token0 = new sdk_core_1.Token(constants_1.ADDRESSES.CHAIN_ID, token0Address, token0Decimals, await token0Contract.symbol());
    const token1 = new sdk_core_1.Token(constants_1.ADDRESSES.CHAIN_ID, token1Address, token1Decimals, await token1Contract.symbol());
    const poolName = `${token0.symbol}/${token1.symbol}`;
    const tickSpacing = await poolContract.tickSpacing();
    const manager = new ethers_1.ethers.Contract(constants_1.ADDRESSES.NONFUNGIBLE_POSITION_MANAGER, abi_1.MANAGER_ABI, signer);
    const pool = new v4_sdk_1.Pool(token0, token1, Number(fee), tickSpacing, walletAddress, slot0.sqrtPriceX96.toString(), liquidity.toString(), Number(slot0.tick));
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
        const isToken0USDC = token0.address.toLowerCase() === constants_1.ADDRESSES.USDC.toLowerCase();
        const sqrtPriceX96 = slot0.sqrtPriceX96;
        let price;
        const sqrtPriceX96Big = BigInt(sqrtPriceX96);
        const priceRaw = (sqrtPriceX96Big * sqrtPriceX96Big) / (BigInt(1) << BigInt(192));
        if (isToken0USDC) {
            price = Number(priceRaw) / 10 ** (token1Decimals - token0Decimals);
        }
        else {
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
            if (position.token0.toLowerCase() === token0.address.toLowerCase() &&
                position.token1.toLowerCase() === token1.address.toLowerCase()) {
                tokenId = Number(tid);
                shouldMintNewPosition = false;
                break;
            }
        }
        // const resp = await estimateSwap(token0Address, 20000000000, token1Address);
        // console.log('resp', resp.percentDiff > -1, resp.percentDiff);
        // return false;
        if (!shouldMintNewPosition) {
            const contractPosition = await manager.positions(tokenId);
            const { tickLower, tickUpper, liquidity, tokensOwed0, tokensOwed1 } = contractPosition;
            const position = new v4_sdk_1.Position({
                pool,
                liquidity: liquidity.toString(),
                tickLower,
                tickUpper,
            });
            console.log(`Position Found in ${poolName} Pool (Token ID: ${tokenId}):`);
            console.log(`- Tick Range: [${tickLower}, ${tickUpper}], currentTick = ${currentTick}`);
            console.log(`- Liquidity: ${ethers_1.ethers.utils.formatUnits(liquidity, 0)} units`);
            console.log(`- Currently in pool: ${position.amount0.toExact()} ${token0.symbol}, ${position.amount1.toExact()} ${token1.symbol}`);
            console.log(jsbi_1.default.toNumber(position.amount0.numerator), jsbi_1.default.toNumber(position.amount1.numerator));
            console.log(`- Fees Owed: ${ethers_1.ethers.utils.formatUnits(tokensOwed0, token1Decimals)} USDC.e, ${ethers_1.ethers.utils.formatUnits(tokensOwed1, token1Decimals)} ${poolName}`);
            // Check if contractPosition is in range
            if (currentTick >= tickLower && currentTick <= tickUpper) {
                if (currentTick - tickLower > BigInt(tickMarginToReenter) && tickUpper - currentTick > BigInt(tickMarginToReenter)) {
                    console.log(`Position is within price range for ${poolName} pool. No action needed.`);
                    return false;
                }
            }
            const estimateResp = await (0, swapTokensOdos_1.estimateSwap)(token0Address, BigInt(jsbi_1.default.toNumber(position.amount0.numerator)), token1Address);
            if (estimateResp.percentDiff < -1 * feeNumber) {
                console.log(`exchange diff ${estimateResp.percentDiff} which is too big, waiting better rate. Exiting..`);
                return false;
            }
            console.log(`Position is out of range for ${poolName} pool. Closing position...`);
            // Close contractPosition
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
                amount0Max: ethers_1.ethers.utils.parseUnits('1000000', token0Decimals),
                amount1Max: ethers_1.ethers.utils.parseUnits('1000000', token1Decimals)
            };
            console.log('Collecting tokens and fees...');
            const collectTx = await manager.collect(collectParams, { gasLimit: 500000 });
            const collectReceipt = await collectTx.wait();
            console.log(`Tokens collected. Tx hash: ${collectReceipt.transactionHash}`);
            console.log('Burning contractPosition NFT...');
            const burnTx = await manager.burn(tokenId, { gasLimit: 300000 });
            const burnReceipt = await burnTx.wait();
            console.log(`Position burned. Tx hash: ${burnReceipt.transactionHash}`);
            shouldMintNewPosition = true;
        }
        if (shouldMintNewPosition) {
            console.log(`No position exists or position closed in ${poolName} pool. Preparing to mint new position...`);
            const token0Balance = await (0, getTokenBalance_1.default)(token0Address, walletAddress);
            const token1Balance = await (0, getTokenBalance_1.default)(token1Address, walletAddress);
            const token0Value = Number(ethers_1.ethers.utils.formatUnits(token0Balance, token0Decimals));
            const token1ValueInToken0 = Number(ethers_1.ethers.utils.formatUnits(token1Balance, token1Decimals)) / price;
            console.log(`Values:`);
            console.log(`total value: ${Number(token0Value + token1ValueInToken0).toFixed(2)} ${token0.symbol}`);
            console.log(`- ${token0.symbol}: ${Number(formatMoney(token0Balance, token0Decimals))}$`);
            console.log(`- ${token1.symbol}: ${Number(Number(ethers_1.ethers.utils.formatUnits(token1Balance, token1Decimals)) / price).toFixed(2)}$`);
            // Mint new position
            let adjustedTickLower = (BigInt(currentTick) - BigInt(tickRange) / 2n) / BigInt(tickSpacing) * BigInt(tickSpacing);
            let adjustedTickUpper = (BigInt(currentTick) + BigInt(tickRange) / 2n) / BigInt(tickSpacing) * BigInt(tickSpacing);
            // if(BigInt(currentTick) - adjustedTickLower < 10n) {
            //     adjustedTickLower -= tickRange;
            // } else if (adjustedTickUpper - BigInt(currentTick) < 10n) {
            //     adjustedTickUpper += tickRange;
            // }
            // const adjustedTickLower = ((BigInt(currentTick) - tickRange) / BigInt(tickSpacing)) * BigInt(tickSpacing);
            // const adjustedTickUpper = ((BigInt(currentTick) + tickRange) / BigInt(tickSpacing)) * BigInt(tickSpacing);
            console.log(`New tick range: [${adjustedTickLower}, ${adjustedTickUpper}], current tick = ${currentTick}`);
            const optimalAmounts = await (0, getOptimalAmounts_1.default)(pool, price, Number(token0Balance), Number(token1Balance), Number(adjustedTickLower), Number(adjustedTickUpper), 0.01);
            console.log('optimalAmounts', optimalAmounts);
            const tokenIn = token1Balance > optimalAmounts.token1Amount ? token1 : token0;
            const tokenOut = token1Balance > optimalAmounts.token1Amount ? token0 : token1;
            const tokenInAmount = token1Balance > optimalAmounts.token1Amount ? token1Balance - optimalAmounts.token1Amount : token0Balance - optimalAmounts.token0Amount;
            console.log(`swapping ${Number(tokenInAmount) / 10 ** tokenIn.decimals} ${tokenIn.symbol} to ${tokenOut.symbol}..`);
            const txReceipt = await (0, swapTokensOdos_1.swapTokensOdos)(walletAddress, tokenIn, tokenInAmount, tokenOut.address, feeNumber, false);
            if (txReceipt == null) {
                return false;
            }
            if (txReceipt.status !== 1) {
                console.log('failed while swapping: ', txReceipt);
                return false;
            }
            console.log('successfully swapped!');
            // Refresh balances
            const token0BalanceFinal = await (0, getTokenBalance_1.default)(token0Address, walletAddress);
            const token1BalanceFinal = await (0, getTokenBalance_1.default)(token1Address, walletAddress);
            const token0BalanceFinalFormatted = ethers_1.ethers.utils.formatUnits(token0BalanceFinal, token0Decimals);
            const token1BalanceFinalFormatted = ethers_1.ethers.utils.formatUnits(token1BalanceFinal, token1Decimals);
            const newToken1BalanceInUSD = Number(token1BalanceFinalFormatted) / price;
            console.log(`Post-swap balances:`);
            console.log(`- ${token0.symbol}: ${formatMoney(token0BalanceFinal, token0Decimals)}`);
            console.log(`- ${token1.symbol}: ${formatMoney(token1BalanceFinal, token1Decimals)} (${newToken1BalanceInUSD} $)`);
            const allowanceUSDC = await token0Contract.allowance(walletAddress, constants_1.ADDRESSES.NONFUNGIBLE_POSITION_MANAGER);
            const allowanceToken1 = await token1Contract.allowance(walletAddress, constants_1.ADDRESSES.NONFUNGIBLE_POSITION_MANAGER);
            if (BigInt(allowanceUSDC) < BigInt(token0BalanceFinal)) {
                await token0Contract.approve(constants_1.ADDRESSES.NONFUNGIBLE_POSITION_MANAGER, token0BalanceFinal, {
                    gasLimit: 100000
                });
                console.log(`Approved ${token0BalanceFinalFormatted} ${token0.symbol}`);
            }
            if (BigInt(allowanceToken1) < BigInt(token1BalanceFinal)) {
                await token1Contract.approve(constants_1.ADDRESSES.NONFUNGIBLE_POSITION_MANAGER, token1BalanceFinal, {
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
            for (let i = 0; i < 5; i++) {
                try {
                    console.log(`Minting new position for ${poolName} pool... trying ${i + 1}`);
                    const mintTx = await manager.mint(mintParams, { gasLimit: 1000000 });
                    const mintReceipt = await mintTx.wait();
                    console.log(`New position minted. Tx hash: ${mintReceipt.transactionHash}`);
                    break;
                }
                catch (error) {
                    // Check for specific error details
                    console.log(`minting tx error ${error.code}: "${error.message}".. `);
                }
            }
        }
        const finalSlot0 = await poolContract.slot0();
        console.log(`Final ${poolName} pool tick: ${finalSlot0.tick}`);
        return true;
    }
    catch (error) {
        console.error(`Error managing ${poolName} pool liquidity position:`, error);
        throw error;
    }
}
async function runWeb3Tasks() {
    try {
        const x33Handled = await manageLiquidityPosition(constants_1.ADDRESSES.USDC_X33_POOL, 1000, 50);
        console.log(`Position management completed: x33=${x33Handled}`);
    }
    catch (error) {
        console.error('Failed to execute web3 tasks:', error);
    }
}
function formatMoney(amount, decimals) {
    return Number(ethers_1.ethers.utils.formatUnits(amount, Number(decimals))).toFixed(2);
}
runWeb3Tasks();
