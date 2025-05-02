import axios from 'axios';

interface UserPoints {
    user_activity_last_detected: string;
    wallet_address: string;
    sonic_points: number;
    loyalty_multiplier: number;
    ecosystem_points: number;
    passive_liquidity_points: number;
    active_liquidity_points: number;
    rank: number;
}

interface PointsResponse {
    items: UserPoints[];
    total: number;
    page: number;
    size: number;
    pages: number;
}

async function fetchPage(page: number): Promise<PointsResponse> {
    const baseUrl = 'https://www.data-openblocklabs.com/sonic/all-users-points-stats';
    const response = await axios.get<PointsResponse>(baseUrl, {
        params: {
            size: 10000,
            page: page,
        },
    });
    return response.data;
}

async function main() {
    // Fetch first page to get total pages
    const firstPageData = await fetchPage(1);
    const totalPages = firstPageData.pages;

    let totalSonicPoints = 0;
    let totalPassiveLiquidityPoints = 0;
    let totalActiveLiquidityPoints = 0;

    for (let page = 1; page <= totalPages; page++) {
        const data = await fetchPage(page);

        for (const item of data.items) {
            totalSonicPoints += item.sonic_points;
            totalPassiveLiquidityPoints += item.passive_liquidity_points;
            totalActiveLiquidityPoints += item.active_liquidity_points;
        }

        console.log(
            `after page ${page}, totals: sonic_points: ${totalSonicPoints}, passive_liquidity_points: ${totalPassiveLiquidityPoints}, active_liquidity_points: ${totalActiveLiquidityPoints}`
        );
    }

    console.log(`final counts: sonic_points=${totalSonicPoints}, passive_liquidity_points=${totalPassiveLiquidityPoints}, active_liquidity_points=${totalActiveLiquidityPoints}`);
}

main().catch(console.error);