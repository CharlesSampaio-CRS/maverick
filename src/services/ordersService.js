const axios = require('axios');
const crypto = require('crypto');
const Operation = require('../models/Operation');
const cacheService = require('./cacheService');

const API_KEY = process.env.NOVADAX_API_KEY;
const API_SECRET = process.env.NOVADAX_API_SECRET;
const BASE_URL = 'https://api.novadax.com';

// HTTP client with timeout and retry configuration
const httpClient = axios.create({
  timeout: 15000, // 15 seconds timeout for order operations
  maxRedirects: 3
});

// Verificar se as variáveis de ambiente estão definidas
if (!API_KEY || !API_SECRET) {
  console.error('[ORDERS] ERROR: NOVADAX_API_KEY or NOVADAX_API_SECRET not defined');
  throw new Error('NOVADAX_API_KEY and NOVADAX_API_SECRET must be defined');
}

function signRequest(method, path, query = '', body = null) {
  const timestamp = Date.now();
  let signStr;

  if (method === 'GET') {
    const sortedQuery = query.split('&').sort().join('&');
    signStr = `${method}\n${path}\n${sortedQuery}\n${timestamp}`;
  } else {
    const content = JSON.stringify(body);
    const md5Hash = crypto.createHash('md5').update(content).digest('hex');
    signStr = `${method}\n${path}\n${md5Hash}\n${timestamp}`;
  }

  const signature = crypto.createHmac('sha256', API_SECRET).update(signStr).digest('hex');

  const headers = {
    'X-Nova-Access-Key': API_KEY,
    'X-Nova-Signature': signature,
    'X-Nova-Timestamp': timestamp,
    ...(method !== 'GET' && { 'Content-Type': 'application/json' })
  };

  return headers;
}

/**
 * Cria uma ordem de compra a mercado para o símbolo informado.
 * Valida saldo, calcula valor seguro e registra operação.
 */
async function createBuyOrder(symbol, amount = null) {
  const balanceService = require('./balanceService');
  const balance = await balanceService.getBalance('BRL');
  const available = parseFloat(balance.available);

  // Use provided amount or calculate safe value
  let value;
  if (amount) {
    value = Math.min(amount, available - 0.20);
  } else {
    // Calcular valor seguro para ordem: múltiplo de 5, margem de R$ 0,20
    value = Math.floor((available - 0.20) / 5) * 5;
  }
  
  if (value < 25) {
    throw new Error('Insufficient BRL balance (minimum R$25 required)');
  }
  value = value.toFixed(2);

  const op = await Operation.create({
    symbol,
    type: 'buy',
    amount: value,
    status: 'pending'
  });

  const path = '/v1/orders/create';
  const url = BASE_URL + path;
  const body = {
    symbol,
    side: 'BUY',
    type: 'MARKET',
    value
  };

  try {
    const headers = signRequest('POST', path, null, body);
    const res = await httpClient.post(url, body, { headers });

    op.status = res.data?.success || res.data?.code === 'A10000' ? 'success' : 'failed';
    // Buscar o preço do ticker para garantir que é BRL
    let tickerPrice = null;
    if (op.status === 'success') {
      try {
        const tickerService = require('./tickerService');
        const ticker = await tickerService.getTicker(symbol);
        if (ticker && ticker.lastPrice) {
          tickerPrice = parseFloat(ticker.lastPrice);
        }
      } catch (err) {
        console.error('[ORDERS] Error fetching ticker price after order:', err.message);
      }
    }
    op.price = tickerPrice || res.data?.data?.price || null;
    op.response = res.data;
    await op.save();

    // Invalidate balance cache after successful order
    if (op.status === 'success') {
      cacheService.invalidateBalance();
    }

    return op;
  } catch (error) {
    op.status = 'failed';
    op.response = { error: error.message, data: error.response?.data };
    await op.save();
    throw error;
  }
}

/**
 * Cria uma ordem de venda a mercado para o símbolo informado.
 * Valida saldo, registra operação e calcula lucro/prejuízo.
 */
async function createSellOrder(symbol, amount) {
  // Validation of amount
  if (!amount || parseFloat(amount) <= 0) {
    throw new Error('Invalid amount: must be greater than 0');
  }

  const amountStr = parseFloat(amount).toFixed(8); // 8 decimal places for crypto

  const op = await Operation.create({
    symbol,
    type: 'sell',
    amount: amount,
    status: 'pending'
  });

  const path = '/v1/orders/create';
  const url = BASE_URL + path;
  const body = {
    symbol,
    side: 'SELL',
    type: 'MARKET', // Ensure market sell
    amount: amountStr
  };

  try {
    const headers = signRequest('POST', path, null, body);
    const res = await httpClient.post(url, body, { headers });

    op.status = res.data?.success || res.data?.code === 'A10000' ? 'success' : 'failed';
    // Buscar o preço do ticker para garantir que é BRL
    let tickerPrice = null;
    if (op.status === 'success') {
      try {
        const tickerService = require('./tickerService');
        const ticker = await tickerService.getTicker(symbol);
        if (ticker && ticker.lastPrice) {
          tickerPrice = parseFloat(ticker.lastPrice);
        }
      } catch (err) {
        console.error('[ORDERS] Error fetching ticker price after order:', err.message);
      }
    }
    op.price = tickerPrice || res.data?.data?.price || null;
    op.response = res.data;

    // --- PROFIT/LOSS CALCULATION ---
    if (op.status === 'success' && op.price) {
      // Find the most recent buy operation for this symbol using lean query
      const lastBuy = await Operation.findOne({
        symbol,
        type: 'buy',
        status: 'success'
      }).sort({ createdAt: -1 }).lean();
      
      if (lastBuy && lastBuy.price) {
        op.buyPrice = lastBuy.price;
        op.profit = (op.price - lastBuy.price) * parseFloat(amount);
      } else {
        op.profit = 0;
      }
    }
    // --- END PROFIT/LOSS CALCULATION ---

    await op.save();

    // Invalidate balance cache after successful order
    if (op.status === 'success') {
      cacheService.invalidateBalance();
    }

    return op;
  } catch (error) {
    console.error(`[ORDERS] SELL Error:`, {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });

    op.status = 'failed';
    op.response = { error: error.message, data: error.response?.data };
    await op.save();
    throw error;
  }
}

module.exports = {
  createBuyOrder,
  createSellOrder
};
