interface Addresses {
    USDC: string;
    X33: string;
    WS: string;
    S: null;
    USDC_X33_POOL: string;
    USDC_WS_POOL: string;
    NONFUNGIBLE_POSITION_MANAGER: string;
    SWAP_ROUTER: string;
    RPC_URL: string;
    CHAIN_ID: number;
}

const ADDRESSES: Addresses = {
    USDC: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
    X33: '0x3333111A391cC08fa51353E9195526A70b333333',
    WS: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
    S: null,
    USDC_X33_POOL: '0x3fccdda302b23f3741df05e698d1300a346d92b1',
    USDC_WS_POOL: '0x324963c267c354c7660ce8ca3f5f167e05649970',
    NONFUNGIBLE_POSITION_MANAGER: '0x12e66c8f215ddd5d48d150c8f46ad0c6fb0f4406',
    SWAP_ROUTER: '0x5543c6176feb9b4b179078205d7c29eea2e2d695',
    RPC_URL: 'https://rpc.soniclabs.com',
    CHAIN_ID: 146
};

function toTokenName(tokenAddress: string): string {
    switch (tokenAddress.toLowerCase()) {
        case ADDRESSES.USDC.toLowerCase():
            return 'USDC.e';
        case ADDRESSES.X33.toLowerCase():
            return 'x33';
        case ADDRESSES.WS?.toLowerCase():
            return 'wS';
        default:
            return 'Unknown';
    }
}

export { ADDRESSES, toTokenName };