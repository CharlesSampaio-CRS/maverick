const axios = require('axios');
const crypto = require('crypto');
const Operation = require('../models/Operation');

const API_KEY = process.env.NOVADAX_API_KEY;
const API_SECRET = process.env.NOVADAX_API_SECRET;
const BASE_URL = 'https://api.novadax.com';

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

async function createBuyOrder(symbol) {
  const balanceService = require('./balanceService');
  const balance = await balanceService.getBalance('BRL');
  const available = parseFloat(balance.available);

  // Calcular valor seguro para ordem: múltiplo de 5, margem de R$ 0,20
  let value = Math.floor((available - 0.20) / 5) * 5;
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
    const res = await axios.post(url, body, { headers });

    op.status = res.data?.success || res.data?.code === 'A10000' ? 'success' : 'failed';
    op.price = res.data?.data?.price || null;
    op.response = res.data;
    await op.save();

    return op;
  } catch (error) {
    op.status = 'failed';
    op.response = { error: error.message, data: error.response?.data };
    await op.save();
    throw error;
  }
}

async function createSellOrder(symbol, amount) {
  // Validation of amount
  if (!amount || parseFloat(amount) <= 0) {
    throw new Error('Invalid amount: must be greater than 0');
  }

  const amountStr = parseFloat(amount).toFixed(8); // 8 decimal places for crypto
  console.log(`[ORDERS] Creating SELL order for ${symbol} amount: ${amountStr}`);

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

  // Additional log to confirm configuration
  console.log(`[ORDERS] Order configuration:`, {
    symbol,
    side: body.side,
    type: body.type, // Should be 'MARKET'
    amount: body.amount
  });

  try {
    const headers = signRequest('POST', path, null, body);
    const res = await axios.post(url, body, { headers });

    console.log(`[ORDERS] API SELL Response:`, res.data);

    // Additional check for order type in response
    if (res.data?.data?.type && res.data.data.type !== 'MARKET') {
      console.warn(`[ORDERS] Warning: Order type mismatch. Expected MARKET, got ${res.data.data.type}`);
    }

    op.status = res.data?.success || res.data?.code === 'A10000' ? 'success' : 'failed';
    op.price = res.data?.data?.price || null;
    op.response = res.data;

    // --- PROFIT/LOSS CALCULATION ---
    if (op.status === 'success' && op.price) {
      // Find the most recent buy operation for this symbol
      const lastBuy = await Operation.findOne({
        symbol,
        type: 'buy',
        status: 'success'
      }).sort({ createdAt: -1 });
      
      if (lastBuy && lastBuy.price) {
        op.buyPrice = lastBuy.price;
        op.profit = (op.price - lastBuy.price) * parseFloat(amount);
        console.log(`[ORDERS] Profit calculation: Sell at ${op.price}, Buy at ${lastBuy.price}, Profit: ${op.profit}`);
      } else {
        op.profit = 0;
        console.log(`[ORDERS] No buy operation found for profit calculation`);
      }
    }
    // --- END PROFIT/LOSS CALCULATION ---

    await op.save();
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
