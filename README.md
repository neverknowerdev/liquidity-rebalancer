This is repositoty to manage liquidity on Shadow.so exchange automatically.

It's expected to be run every X seconds.

Tested on USDC.e/x33 pair.

Logic:
- get all balance on both tokens
- estimate proportion of tokens needed to put to liquidity pool with provided params (tickRange).
- exchange needed amount of tokenA to tokenB or vice-verca to match that proportion:
- exchanging using Odos protocol to get best routing and fees
- if slippage is too big - wait until it gets better (not to loose a lot of money on single swap)
- opens positions with tokens
- monitor when position is in range, when it's out - start algorithm again
