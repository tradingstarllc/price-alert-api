/**
 * Price Alert API - Lightweight Express Server
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

// In-memory API key store (production: use Redis/DB)
const apiKeys = new Map();
const pendingPayments = new Map();

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
        // Try v8 API first
        const res = await axios.get(
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
            { 
                timeout: 5000, 
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                } 
            }
        );
        const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (price) {
            priceCache.set(cacheKey, { price, timestamp: Date.now() });
            return price;
        }
    } catch (err) {
        // Fallback to quote endpoint
        try {
            const res = await axios.get(
                `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price`,
                { 
                    timeout: 5000, 
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    } 
                }
            );
            const price = res.data?.quoteSummary?.result?.[0]?.price?.regularMarketPrice?.raw;
            if (price) {
                priceCache.set(cacheKey, { price, timestamp: Date.now() });
                return price;
            }
        } catch (e) {
            // Both failed
        }
    }
    return null;
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

// ==================== PAYMENT ENDPOINTS ====================

// Create a payment session
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
        // Create CryptAPI payment address for SOL/USDC
        const callbackUrl = encodeURIComponent(
            `${req.protocol}://${req.get('host')}/payment/webhook?order_id=${orderId}`
        );
        
        const response = await axios.get(
            `https://api.cryptapi.io/sol/usdc/create/?callback=${callbackUrl}&address=${PAYMENT_WALLET}&pending=1`,
            { timeout: 10000 }
        );
        
        if (response.data.status === 'success') {
            // Store pending payment
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

// Payment webhook (called by CryptAPI)
app.all('/payment/webhook', async (req, res) => {
    const data = req.method === 'GET' ? req.query : req.body;
    const { order_id } = req.query;
    
    const payment = pendingPayments.get(order_id);
    if (!payment) {
        return res.status(200).send('*ok*');
    }
    
    const valueCoin = parseFloat(data.value_coin || 0);
    const pending = parseInt(data.pending || 0);
    
    // Check if payment received and confirmed
    if (pending === 0 && valueCoin >= payment.plan.price * 0.95) { // 5% tolerance
        // Generate API key
        const apiKey = 'pk_' + crypto.randomBytes(16).toString('hex');
        const expiresAt = Date.now() + (API_KEY_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
        
        apiKeys.set(apiKey, {
            plan: payment.plan.name,
            callsRemaining: payment.plan.calls,
            email: payment.email,
            createdAt: Date.now(),
            expiresAt
        });
        
        // Update payment status
        payment.status = 'completed';
        payment.apiKey = apiKey;
        payment.txid = data.txid_in;
        
        console.log(`Payment confirmed for ${order_id}: ${apiKey}`);
    }
    
    res.status(200).send('*ok*');
});

// Check payment status / retrieve API key
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
            message: 'Use this API key in the X-API-Key header for authenticated requests'
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

// Validate API key middleware
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    // Allow free tier for basic endpoints
    if (!apiKey) {
        req.rateLimit = { calls: 10, period: 'hour' }; // Free tier
        return next();
    }
    
    const keyData = apiKeys.get(apiKey);
    if (!keyData) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    
    if (Date.now() > keyData.expiresAt) {
        return res.status(401).json({ error: 'API key expired' });
    }
    
    if (keyData.callsRemaining <= 0) {
        return res.status(429).json({ error: 'API calls exhausted' });
    }
    
    keyData.callsRemaining--;
    req.keyData = keyData;
    next();
};

// Root
app.get('/', (req, res) => {
    res.json({
        name: 'Price Alert API',
        version: '2.0.0',
        endpoints: [
            'GET /price/:type/:symbol - Get current price',
            'POST /alert/check - Check alert condition',
            'POST /price/batch - Batch price check (max 10)',
            'GET /health - Health check',
            'POST /payment/create - Create payment (plans: basic/pro/unlimited)',
            'GET /payment/status/:orderId - Check payment & get API key'
        ],
        pricing: {
            free: '10 calls/hour, no API key needed',
            basic: '$5/month - 1,000 calls',
            pro: '$15/month - 10,000 calls',
            unlimited: '$50/month - unlimited calls'
        },
        payment: 'USDC on Solana (instant, low fees)',
        examples: {
            crypto: '/price/crypto/bitcoin',
            stock: '/price/stock/AAPL'
        }
    });
});

app.listen(PORT, () => {
    console.log(`Price Alert API running on port ${PORT}`);
});
