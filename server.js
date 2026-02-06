/**
 * Price Alert API - Lightweight Express Server
 * Ready to deploy on Railway/Render/Fly.io (free tiers)
 * Then list on RapidAPI for monetization
 */

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// In-memory cache for prices (production: use Redis)
const priceCache = new Map();
const CACHE_TTL = 60000; // 60 seconds

// Helper: Get crypto price from CoinGecko (free, no key needed)
async function getCryptoPrice(symbol) {
    const cacheKey = `crypto:${symbol}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.price;
    }

    try {
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`,
            { timeout: 5000 }
        );
        const price = res.data[symbol]?.usd;
        if (price) {
            priceCache.set(cacheKey, { price, timestamp: Date.now() });
        }
        return price;
    } catch (err) {
        return null;
    }
}

// Helper: Get stock price from Yahoo Finance (free, no key needed)
async function getStockPrice(symbol) {
    const cacheKey = `stock:${symbol}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.price;
    }

    try {
        const res = await axios.get(
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
            { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (price) {
            priceCache.set(cacheKey, { price, timestamp: Date.now() });
        }
        return price;
    } catch (err) {
        return null;
    }
}

// Endpoint: Get current price
app.get('/price/:type/:symbol', async (req, res) => {
    const { type, symbol } = req.params;
    
    if (!['crypto', 'stock'].includes(type)) {
        return res.status(400).json({ error: 'Type must be crypto or stock' });
    }
    
    const price = type === 'crypto' 
        ? await getCryptoPrice(symbol.toLowerCase())
        : await getStockPrice(symbol.toUpperCase());
    
    if (price === null) {
        return res.status(404).json({ error: 'Symbol not found or API error' });
    }
    
    res.json({
        type,
        symbol: symbol.toUpperCase(),
        price,
        currency: 'USD',
        timestamp: new Date().toISOString()
    });
});

// Endpoint: Check alert condition
app.post('/alert/check', async (req, res) => {
    const { type, symbol, condition, threshold } = req.body;
    
    if (!type || !symbol || !condition || threshold === undefined) {
        return res.status(400).json({ 
            error: 'Required: type, symbol, condition (above/below/change), threshold' 
        });
    }
    
    const price = type === 'crypto'
        ? await getCryptoPrice(symbol.toLowerCase())
        : await getStockPrice(symbol.toUpperCase());
    
    if (price === null) {
        return res.status(404).json({ error: 'Symbol not found' });
    }
    
    let triggered = false;
    let message = '';
    
    switch (condition) {
        case 'above':
            triggered = price >= threshold;
            message = triggered 
                ? `🚀 ${symbol} is above $${threshold}: $${price}`
                : `${symbol} is at $${price}, waiting for $${threshold}`;
            break;
        case 'below':
            triggered = price <= threshold;
            message = triggered
                ? `📉 ${symbol} is below $${threshold}: $${price}`
                : `${symbol} is at $${price}, waiting for $${threshold}`;
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

// Endpoint: Batch check multiple symbols
app.post('/price/batch', async (req, res) => {
    const { symbols } = req.body; // [{ type: 'crypto', symbol: 'bitcoin' }, ...]
    
    if (!symbols || !Array.isArray(symbols)) {
        return res.status(400).json({ error: 'Required: symbols array' });
    }
    
    const results = await Promise.all(
        symbols.slice(0, 10).map(async ({ type, symbol }) => {
            const price = type === 'crypto'
                ? await getCryptoPrice(symbol.toLowerCase())
                : await getStockPrice(symbol.toUpperCase());
            return { type, symbol: symbol.toUpperCase(), price, error: price === null };
        })
    );
    
    res.json({
        results,
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Root
app.get('/', (req, res) => {
    res.json({
        name: 'Price Alert API',
        version: '1.0.0',
        endpoints: [
            'GET /price/:type/:symbol - Get current price',
            'POST /alert/check - Check alert condition',
            'POST /price/batch - Batch price check (max 10)',
            'GET /health - Health check'
        ],
        examples: {
            crypto: '/price/crypto/bitcoin',
            stock: '/price/stock/AAPL'
        }
    });
});

app.listen(PORT, () => {
    console.log(`Price Alert API running on port ${PORT}`);
});
