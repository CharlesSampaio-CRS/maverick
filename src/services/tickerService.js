const axios = require('axios');
const cacheService = require('./cacheService');
const BASE_URL = 'https://api.novadax.com';

// HTTP client with timeout and retry configuration
const httpClient = axios.create({
  timeout: 5000, // 5 seconds timeout
  maxRedirects: 3
});

/**
 * Obtém o ticker (preço e variação) de um símbolo.
 * Sempre busca dado atualizado da API (sem cache).
 */
async function getTicker(symbol) {
  const path = '/v1/market/ticker';
  const url = `${BASE_URL}${path}?symbol=${symbol}`;
  try {
    const res = await httpClient.get(url);
    const d = res.data.data;
    if (!d) {
      return { success: false, error: 'Ticker not found or unexpected response', details: res.data };
    }
    let changePercent = d.changePercent24h;
    if (!changePercent || changePercent === '0' || changePercent === '0.00') {
      const currentPrice = parseFloat(d.lastPrice);
      const openPrice = parseFloat(d.open24h);
      changePercent = ((currentPrice - openPrice) / openPrice * 100).toFixed(2);
    }
    const now = Date.now();
    const dataAge = now - d.timestamp;
    return {
      success: true,
      symbol: d.symbol,
      lastPrice: d.lastPrice,
      bid: d.bid,
      ask: d.ask,
      high24h: d.high24h,
      low24h: d.low24h,
      open24h: d.open24h,
      baseVolume24h: d.baseVolume24h,
      quoteVolume24h: d.quoteVolume24h,
      change24h: d.change24h,
      changePercent24h: changePercent,
      timestamp: d.timestamp,
      dataAge: Math.round(dataAge/1000)
    };
  } catch (err) {
    console.error(`[TICKER] Error fetching ${symbol}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Obtém tickers de múltiplos símbolos em batch (sem cache).
 */
async function getTickers(symbols) {
  const results = {};
  const promises = symbols.map(symbol => getTicker(symbol));
  const fetchedResults = await Promise.allSettled(promises);
  symbols.forEach((symbol, index) => {
    const result = fetchedResults[index];
    if (result.status === 'fulfilled') {
      results[symbol] = result.value;
    } else {
      results[symbol] = { success: false, error: result.reason.message };
    }
  });
  return results;
}

module.exports = {
  getTicker,
  getTickers
}; 