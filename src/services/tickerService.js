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
    
    // Calculate percentage change manually
    const currentPrice = parseFloat(d.lastPrice);
    const openPrice = parseFloat(d.open24h);
    const changePercent = ((currentPrice - openPrice) / openPrice * 100).toFixed(2);
    
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
      changePercent24h: changePercent, // Only calculated value
      timestamp: d.timestamp
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  getTicker
}; 