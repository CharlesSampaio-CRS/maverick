const axios = require('axios');
const BASE_URL = 'https://api.novadax.com';

async function get(symbol) {
  const path = '/v1/market/ticker';
  const url = `${BASE_URL}${path}?symbol=${symbol}`;
  try {
    const res = await axios.get(url);
    if (!res.data || !res.data.data) {
      return { success: false, error: 'Ticker não encontrado ou resposta inesperada', details: res.data };
    }
    const d = res.data.data;
    
    // Calcular variação percentual manualmente
    const openPrice = parseFloat(d.open24h);
    const currentPrice = parseFloat(d.lastPrice);
    const changePercent = ((currentPrice - openPrice) / openPrice * 100).toFixed(2);
    
    // Log simplificado: símbolo, preço e variação
    console.log(`[TICKER] ${d.symbol} | Preço: ${d.lastPrice} | Variação 24h: ${changePercent}%`);
    
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
      timestamp: d.timestamp
    };
  } catch (err) {
    console.error('Erro ao consultar ticker NovaDAX:', err.response?.data || err.message);
    return { success: false, error: 'Erro ao consultar ticker NovaDAX', details: err.response?.data || err.message };
  }
}

module.exports = {
  get
}; 