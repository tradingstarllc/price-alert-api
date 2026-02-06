/**
 * Price Alert API v3.0 - Comprehensive Market Data API
 * With CryptAPI Solana payments integration
 */

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Payment config - Solana wallet
const PAYMENT_WALLET = '82rh4CG9bMfVLFcpWwUXAscVkAgtDqCXgcQ4k2bjuoEx';
const API_KEY_VALIDITY_DAYS = 30;

// In-memory stores (production: use Redis/DB)
const apiKeys = new Map();
const pendingPayments = new Map();
const priceCache = new Map();
const historyCache = new Map();
const CACHE_TTL = 60000; // 60 seconds
const HISTORY_CACHE_TTL = 300000; // 5 minutes

// ==================== HELPER FUNCTIONS ====================

// Get crypto price from CoinGecko
async function getCryptoPrice(symbol) {
    const cacheKey = `crypto:${symbol}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
            { timeout: 5000 }
        );
        const data = res.data[symbol];
        if (data) {
            const result = {
                price: data.usd,
                change24h: data.usd_24h_change,
                volume24h: data.usd_24h_vol,
                marketCap: data.usd_market_cap
            };
            priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        }
    } catch (err) {}
    return null;
}

// Get detailed crypto data
async function getCryptoDetails(symbol) {
    const cacheKey = `crypto-details:${symbol}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/coins/${symbol}?localization=false&tickers=false&community_data=false&developer_data=false`,
            { timeout: 8000 }
        );
        const coin = res.data;
        const result = {
            id: coin.id,
            symbol: coin.symbol.toUpperCase(),
            name: coin.name,
            price: coin.market_data.current_price.usd,
            change1h: coin.market_data.price_change_percentage_1h_in_currency?.usd,
            change24h: coin.market_data.price_change_percentage_24h,
            change7d: coin.market_data.price_change_percentage_7d,
            change30d: coin.market_data.price_change_percentage_30d,
            marketCap: coin.market_data.market_cap.usd,
            marketCapRank: coin.market_cap_rank,
            volume24h: coin.market_data.total_volume.usd,
            high24h: coin.market_data.high_24h.usd,
            low24h: coin.market_data.low_24h.usd,
            ath: coin.market_data.ath.usd,
            athDate: coin.market_data.ath_date.usd,
            athChange: coin.market_data.ath_change_percentage.usd,
            atl: coin.market_data.atl.usd,
            atlDate: coin.market_data.atl_date.usd,
            circulatingSupply: coin.market_data.circulating_supply,
            totalSupply: coin.market_data.total_supply,
            maxSupply: coin.market_data.max_supply
        };
        priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch (err) {}
    return null;
}

// Get crypto price history
async function getCryptoHistory(symbol, days = 7) {
    const cacheKey = `history:${symbol}:${days}`;
    const cached = historyCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < HISTORY_CACHE_TTL) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/coins/${symbol}/market_chart?vs_currency=usd&days=${days}`,
            { timeout: 10000 }
        );
        const result = {
            prices: res.data.prices.map(([t, p]) => ({ timestamp: t, price: p })),
            volumes: res.data.total_volumes.map(([t, v]) => ({ timestamp: t, volume: v }))
        };
        historyCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch (err) {}
    return null;
}

// Get trending cryptos
async function getTrendingCryptos() {
    const cacheKey = 'trending';
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL * 5) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            'https://api.coingecko.com/api/v3/search/trending',
            { timeout: 5000 }
        );
        const result = res.data.coins.map(c => ({
            id: c.item.id,
            symbol: c.item.symbol,
            name: c.item.name,
            marketCapRank: c.item.market_cap_rank,
            priceBtc: c.item.price_btc
        }));
        priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch (err) {}
    return null;
}

// Get global market data
async function getGlobalMarketData() {
    const cacheKey = 'global';
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL * 2) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            'https://api.coingecko.com/api/v3/global',
            { timeout: 5000 }
        );
        const g = res.data.data;
        const result = {
            totalMarketCap: g.total_market_cap.usd,
            totalVolume24h: g.total_volume.usd,
            btcDominance: g.market_cap_percentage.btc,
            ethDominance: g.market_cap_percentage.eth,
            activeCryptos: g.active_cryptocurrencies,
            markets: g.markets,
            marketCapChange24h: g.market_cap_change_percentage_24h_usd
        };
        priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch (err) {}
    return null;
}

// Get Fear & Greed Index
async function getFearGreedIndex() {
    const cacheKey = 'feargreed';
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL * 10) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            'https://api.alternative.me/fng/?limit=7',
            { timeout: 5000 }
        );
        const result = {
            current: {
                value: parseInt(res.data.data[0].value),
                classification: res.data.data[0].value_classification,
                timestamp: res.data.data[0].timestamp
            },
            history: res.data.data.map(d => ({
                value: parseInt(d.value),
                classification: d.value_classification,
                date: new Date(d.timestamp * 1000).toISOString().split('T')[0]
            }))
        };
        priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch (err) {}
    return null;
}

// Get stock price from Yahoo Finance
async function getStockPrice(symbol) {
    const cacheKey = `stock:${symbol}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`,
            { 
                timeout: 5000, 
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                } 
            }
        );
        const meta = res.data?.chart?.result?.[0]?.meta;
        const quote = res.data?.chart?.result?.[0]?.indicators?.quote?.[0];
        if (meta) {
            const result = {
                price: meta.regularMarketPrice,
                previousClose: meta.previousClose,
                change: meta.regularMarketPrice - meta.previousClose,
                changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
                high: quote?.high?.[quote.high.length - 1],
                low: quote?.low?.[quote.low.length - 1],
                volume: quote?.volume?.[quote.volume.length - 1],
                marketState: meta.marketState,
                exchange: meta.exchangeName,
                currency: meta.currency
            };
            priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        }
    } catch (err) {}
    return null;
}

// Get forex rates
async function getForexRates(base = 'USD') {
    const cacheKey = `forex:${base}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL * 5) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            `https://api.exchangerate-api.com/v4/latest/${base}`,
            { timeout: 5000 }
        );
        const result = {
            base: res.data.base,
            date: res.data.date,
            rates: res.data.rates
        };
        priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch (err) {}
    return null;
}

// Get gas prices (Ethereum)
async function getGasPrices() {
    const cacheKey = 'gas';
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30000) {
        return cached.data;
    }

    try {
        const res = await axios.get(
            'https://api.etherscan.io/api?module=gastracker&action=gasoracle',
            { timeout: 5000 }
        );
        if (res.data.status === '1') {
            const g = res.data.result;
            const result = {
                slow: parseInt(g.SafeGasPrice),
                standard: parseInt(g.ProposeGasPrice),
                fast: parseInt(g.FastGasPrice),
                baseFee: parseFloat(g.suggestBaseFee),
                unit: 'gwei'
            };
            priceCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        }
    } catch (err) {}
    return null;
}

// Convert between currencies/cryptos
async function convert(from, to, amount) {
    try {
        // Try crypto first
        const cryptoRes = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${from.toLowerCase()}&vs_currencies=${to.toLowerCase()}`,
            { timeout: 5000 }
        );
        if (cryptoRes.data[from.toLowerCase()]?.[to.toLowerCase()]) {
            const rate = cryptoRes.data[from.toLowerCase()][to.toLowerCase()];
            return { from, to, amount, rate, result: amount * rate };
        }
    } catch (err) {}
    
    // Try forex
    try {
        const forexRes = await axios.get(
            `https://api.exchangerate-api.com/v4/latest/${from.toUpperCase()}`,
            { timeout: 5000 }
        );
        if (forexRes.data.rates[to.toUpperCase()]) {
            const rate = forexRes.data.rates[to.toUpperCase()];
            return { from, to, amount, rate, result: amount * rate };
        }
    } catch (err) {}
    
    return null;
}

// ==================== API ENDPOINTS ====================

// Get current price (enhanced)
app.get('/price/:type/:symbol', async (req, res) => {
    const { type, symbol } = req.params;
    const { detailed } = req.query;
    
    if (!['crypto', 'stock', 'forex'].includes(type)) {
        return res.status(400).json({ error: 'Type must be crypto, stock, or forex' });
    }
    
    let data;
    if (type === 'crypto') {
        data = detailed === 'true' 
            ? await getCryptoDetails(symbol.toLowerCase())
            : await getCryptoPrice(symbol.toLowerCase());
    } else if (type === 'stock') {
        data = await getStockPrice(symbol.toUpperCase());
    } else if (type === 'forex') {
        const rates = await getForexRates(symbol.toUpperCase());
        data = rates ? { base: rates.base, rates: rates.rates } : null;
    }
    
    if (!data) {
        return res.status(404).json({ error: 'Symbol not found or API error' });
    }
    
    res.json({
        type,
        symbol: symbol.toUpperCase(),
        ...data,
        timestamp: new Date().toISOString()
    });
});

// Price history (crypto only)
app.get('/history/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const days = parseInt(req.query.days) || 7;
    
    if (days > 365) {
        return res.status(400).json({ error: 'Max 365 days' });
    }
    
    const data = await getCryptoHistory(symbol.toLowerCase(), days);
    if (!data) {
        return res.status(404).json({ error: 'Symbol not found' });
    }
    
    res.json({
        symbol: symbol.toUpperCase(),
        days,
        dataPoints: data.prices.length,
        ...data,
        timestamp: new Date().toISOString()
    });
});

// Trending cryptos
app.get('/trending', async (req, res) => {
    const data = await getTrendingCryptos();
    if (!data) {
        return res.status(500).json({ error: 'Failed to fetch trending' });
    }
    res.json({ trending: data, timestamp: new Date().toISOString() });
});

// Global market data
app.get('/market/global', async (req, res) => {
    const data = await getGlobalMarketData();
    if (!data) {
        return res.status(500).json({ error: 'Failed to fetch market data' });
    }
    res.json({ ...data, timestamp: new Date().toISOString() });
});

// Fear & Greed Index
app.get('/market/fear-greed', async (req, res) => {
    const data = await getFearGreedIndex();
    if (!data) {
        return res.status(500).json({ error: 'Failed to fetch fear/greed index' });
    }
    res.json({ ...data, timestamp: new Date().toISOString() });
});

// Gas prices
app.get('/market/gas', async (req, res) => {
    const data = await getGasPrices();
    if (!data) {
        return res.status(500).json({ error: 'Failed to fetch gas prices' });
    }
    res.json({ network: 'Ethereum', ...data, timestamp: new Date().toISOString() });
});

// Currency conversion
app.get('/convert', async (req, res) => {
    const { from, to, amount } = req.query;
    
    if (!from || !to) {
        return res.status(400).json({ error: 'Required: from, to, amount (optional, default 1)' });
    }
    
    const result = await convert(from, to, parseFloat(amount) || 1);
    if (!result) {
        return res.status(404).json({ error: 'Conversion pair not found' });
    }
    
    res.json({ ...result, timestamp: new Date().toISOString() });
});

// Check alert condition
app.post('/alert/check', async (req, res) => {
    const { type, symbol, condition, threshold } = req.body;
    
    if (!type || !symbol || !condition || threshold === undefined) {
        return res.status(400).json({ 
            error: 'Required: type, symbol, condition (above/below), threshold' 
        });
    }
    
    const data = type === 'crypto'
        ? await getCryptoPrice(symbol.toLowerCase())
        : await getStockPrice(symbol.toUpperCase());
    
    const price = data?.price || data;
    if (price === null || price === undefined) {
        return res.status(404).json({ error: 'Symbol not found' });
    }
    
    let triggered = false;
    let message = '';
    
    switch (condition) {
        case 'above':
            triggered = price >= threshold;
            message = triggered 
                ? `🚀 ${symbol} is above $${threshold}: $${price.toFixed(2)}`
                : `${symbol} is at $${price.toFixed(2)}, waiting for $${threshold}`;
            break;
        case 'below':
            triggered = price <= threshold;
            message = triggered
                ? `📉 ${symbol} is below $${threshold}: $${price.toFixed(2)}`
                : `${symbol} is at $${price.toFixed(2)}, waiting for $${threshold}`;
            break;
        default:
            return res.status(400).json({ error: 'Condition must be above or below' });
    }
    
    res.json({
        symbol: symbol.toUpperCase(),
        price,
        threshold,
        condition,
        triggered,
        message,
        timestamp: new Date().toISOString()
    });
});

// Batch price check
app.post('/price/batch', async (req, res) => {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
        return res.status(400).json({ error: 'Required: symbols array [{type, symbol}, ...]' });
    }
    
    const results = await Promise.all(
        symbols.slice(0, 20).map(async ({ type, symbol }) => {
            let data;
            if (type === 'crypto') {
                data = await getCryptoPrice(symbol.toLowerCase());
            } else if (type === 'stock') {
                data = await getStockPrice(symbol.toUpperCase());
            }
            return { 
                type, 
                symbol: symbol.toUpperCase(), 
                price: data?.price || data,
                change24h: data?.change24h || data?.changePercent,
                error: data === null 
            };
        })
    );
    
    res.json({ results, timestamp: new Date().toISOString() });
});

// Search for cryptos
app.get('/search/:query', async (req, res) => {
    const { query } = req.params;
    
    try {
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
            { timeout: 5000 }
        );
        
        const results = response.data.coins.slice(0, 10).map(c => ({
            id: c.id,
            symbol: c.symbol,
            name: c.name,
            marketCapRank: c.market_cap_rank
        }));
        
        res.json({ query, results, timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: 'Search failed' });
    }
});

// Top coins by market cap
app.get('/top/:limit?', async (req, res) => {
    const limit = Math.min(parseInt(req.params.limit) || 10, 100);
    
    try {
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`,
            { timeout: 10000 }
        );
        
        const coins = response.data.map(c => ({
            rank: c.market_cap_rank,
            id: c.id,
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            price: c.current_price,
            change24h: c.price_change_percentage_24h,
            marketCap: c.market_cap,
            volume24h: c.total_volume
        }));
        
        res.json({ coins, timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch top coins' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        cacheSize: priceCache.size,
        timestamp: new Date().toISOString()
    });
});

// ==================== PAYMENT ENDPOINTS ====================

app.post('/payment/create', async (req, res) => {
    const { plan, email } = req.body;
    
    const plans = {
        basic: { price: 5, calls: 1000, name: 'Basic' },
        pro: { price: 15, calls: 10000, name: 'Pro' },
        unlimited: { price: 50, calls: 999999, name: 'Unlimited' }
    };
    
    const selectedPlan = plans[plan] || plans.basic;
    const orderId = crypto.randomBytes(8).toString('hex');
    
    try {
        const callbackUrl = encodeURIComponent(
            `${req.protocol}://${req.get('host')}/payment/webhook?order_id=${orderId}`
        );
        
        const response = await axios.get(
            `https://api.cryptapi.io/sol/usdc/create/?callback=${callbackUrl}&address=${PAYMENT_WALLET}&pending=1`,
            { timeout: 10000 }
        );
        
        if (response.data.status === 'success') {
            pendingPayments.set(orderId, {
                plan: selectedPlan,
                email: email || null,
                address_in: response.data.address_in,
                status: 'pending',
                created: Date.now()
            });
            
            res.json({
                orderId,
                plan: selectedPlan.name,
                priceUSD: selectedPlan.price,
                payment: {
                    address: response.data.address_in,
                    network: 'Solana',
                    token: 'USDC',
                    amount: selectedPlan.price,
                    minimum: response.data.minimum_transaction_coin
                },
                instructions: 'Send USDC on Solana to the address above. API key will be generated automatically.'
            });
        } else {
            res.status(500).json({ error: 'Failed to create payment address' });
        }
    } catch (err) {
        console.error('Payment creation error:', err.message);
        res.status(500).json({ error: 'Payment service unavailable' });
    }
});

app.all('/payment/webhook', async (req, res) => {
    const data = req.method === 'GET' ? req.query : req.body;
    const { order_id } = req.query;
    
    const payment = pendingPayments.get(order_id);
    if (!payment) {
        return res.status(200).send('*ok*');
    }
    
    const valueCoin = parseFloat(data.value_coin || 0);
    const pending = parseInt(data.pending || 0);
    
    if (pending === 0 && valueCoin >= payment.plan.price * 0.95) {
        const apiKey = 'pk_' + crypto.randomBytes(16).toString('hex');
        const expiresAt = Date.now() + (API_KEY_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
        
        apiKeys.set(apiKey, {
            plan: payment.plan.name,
            callsRemaining: payment.plan.calls,
            email: payment.email,
            createdAt: Date.now(),
            expiresAt
        });
        
        payment.status = 'completed';
        payment.apiKey = apiKey;
        payment.txid = data.txid_in;
        
        console.log(`Payment confirmed for ${order_id}: ${apiKey}`);
    }
    
    res.status(200).send('*ok*');
});

app.get('/payment/status/:orderId', (req, res) => {
    const payment = pendingPayments.get(req.params.orderId);
    
    if (!payment) {
        return res.status(404).json({ error: 'Order not found' });
    }
    
    if (payment.status === 'completed' && payment.apiKey) {
        res.json({
            status: 'completed',
            apiKey: payment.apiKey,
            plan: payment.plan.name,
            message: 'Use this API key in the X-API-Key header'
        });
    } else {
        res.json({
            status: 'pending',
            address: payment.address_in,
            plan: payment.plan.name,
            priceUSD: payment.plan.price,
            message: 'Waiting for payment confirmation...'
        });
    }
});

// Root - API documentation
app.get('/', (req, res) => {
    res.json({
        name: 'Price Alert API',
        version: '3.0.0',
        description: 'Comprehensive market data API for crypto, stocks, and forex',
        endpoints: {
            prices: {
                'GET /price/:type/:symbol': 'Get price (type: crypto/stock/forex, add ?detailed=true for more)',
                'GET /history/:symbol?days=7': 'Get price history (crypto, max 365 days)',
                'POST /price/batch': 'Batch price check (max 20)',
                'GET /convert?from=X&to=Y&amount=1': 'Currency/crypto conversion'
            },
            market: {
                'GET /trending': 'Trending cryptocurrencies',
                'GET /top/:limit': 'Top coins by market cap (max 100)',
                'GET /market/global': 'Global crypto market data',
                'GET /market/fear-greed': 'Fear & Greed Index',
                'GET /market/gas': 'Ethereum gas prices'
            },
            search: {
                'GET /search/:query': 'Search for cryptocurrencies'
            },
            alerts: {
                'POST /alert/check': 'Check alert condition'
            },
            payments: {
                'POST /payment/create': 'Create payment (plans: basic/pro/unlimited)',
                'GET /payment/status/:orderId': 'Check payment & get API key'
            }
        },
        pricing: {
            free: '10 calls/hour, no API key needed',
            basic: '$5/month - 1,000 calls',
            pro: '$15/month - 10,000 calls',
            unlimited: '$50/month - unlimited calls'
        },
        payment: 'USDC on Solana (instant, low fees)',
        examples: {
            cryptoPrice: '/price/crypto/bitcoin',
            cryptoDetailed: '/price/crypto/ethereum?detailed=true',
            stockPrice: '/price/stock/AAPL',
            history: '/history/bitcoin?days=30',
            convert: '/convert?from=bitcoin&to=usd&amount=1',
            top10: '/top/10',
            search: '/search/sol'
        }
    });
});

app.listen(PORT, () => {
    console.log(`Price Alert API v3.0 running on port ${PORT}`);
});
