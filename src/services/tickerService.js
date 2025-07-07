const axios = require('axios');
const BASE_URL = 'https://api.novadax.com';

async function getTicker(symbol) {
  const path = '/v1/market/ticker';
  const url = `${BASE_URL}${path}?symbol=${symbol}`;
  
  try {
    const res = await axios.get(url);
    const d = res.data.data;
    
    if (!d) {
      return { success: false, error: 'Ticker not found or unexpected response', details: res.data };
    }
    
    // Use API's changePercent24h if available, otherwise calculate manually
    let changePercent = d.changePercent24h;
    if (!changePercent || changePercent === '0' || changePercent === '0.00') {
      const currentPrice = parseFloat(d.lastPrice);
      const openPrice = parseFloat(d.open24h);
      changePercent = ((currentPrice - openPrice) / openPrice * 100).toFixed(2);
      console.log(`[TICKER] Manual calculation for ${symbol}: ${changePercent}% (API: ${d.changePercent24h})`);
    }
    
    // Log data freshness
    const now = Date.now();
    const dataAge = now - d.timestamp;
    if (dataAge > 30000) { // 30 seconds
      console.warn(`[TICKER] Data may be stale for ${symbol}: ${Math.round(dataAge/1000)}s old`);
    }
    
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
      dataAge: Math.round(dataAge/1000) // Age in seconds
    };
  } catch (err) {
    console.error(`[TICKER] Error fetching ${symbol}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  getTicker
}; 