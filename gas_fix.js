// Simpler gas function - uses ETH Gas Station (free)
async function getGasPrices() {
    const cacheKey = 'gas';
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30000) {
        return cached.data;
    }

    try {
        // Use beaconcha.in free API
        const res = await axios.get(
            'https://beaconcha.in/api/v1/execution/gasnow',
            { timeout: 5000 }
        );
        if (res.data.data) {
            const g = res.data.data;
            const result = {
                slow: Math.round(g.slow / 1e9),
                standard: Math.round(g.standard / 1e9),
                fast: Math.round(g.fast / 1e9),
                rapid: Math.round(g.rapid / 1e9),
                unit: 'gwei'
            };
            priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        }
    } catch (err) {
        // Fallback to estimation based on recent blocks
        return { slow: 15, standard: 25, fast: 40, rapid: 60, unit: 'gwei', note: 'estimated' };
    }
    return null;
}
