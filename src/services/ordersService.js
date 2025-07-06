const axios = require('axios');
const Operation = require('../models/Operation');

const API_KEY = process.env.NOVADAX_API_KEY;
const API_SECRET = process.env.NOVADAX_API_SECRET;
const BASE_URL = 'https://api.novadax.com';

function signRequest(method, path, query = '', body = null) {
  const timestamp = Date.now().toString();
  let signStr;
  if (method === 'GET') {
    const sortedQuery = query ? query.split('&').sort().join('&') : '';
    signStr = `${method}\n${path}\n${sortedQuery}\n${timestamp}`;
  } else {
    const content = body ? JSON.stringify(body) : '';
    const md5Hash = require('crypto').createHash('md5').update(content).digest('hex');
    signStr = `${method}\n${path}\n${md5Hash}\n${timestamp}`;
  }
  const signature = require('crypto')
    .createHmac('sha256', API_SECRET)
    .update(signStr)
    .digest('hex');
  const headers = {
    'X-Nova-Access-Key': API_KEY,
    'X-Nova-Timestamp': timestamp,
    'X-Nova-Signature': signature,
  };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  return headers;
}

async function buy(symbol, amount) {
  const op = await Operation.create({ symbol, type: 'buy', amount, status: 'pending' });
  const path = '/v1/orders/create';
  const url = BASE_URL + path;
  const body = {
    symbol,
    side: 'BUY',
    type: 'MARKET',
    value: amount
  };
  try {
    const headers = signRequest('POST', path, null, body);
    const res = await axios.post(url, body, { headers });
    op.status = (res.data && (res.data.success || res.data.code === 'A10000')) ? 'success' : 'failed';
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

async function sell(symbol, amount) {
  const op = await Operation.create({ symbol, type: 'sell', amount, status: 'pending' });
  const path = '/v1/orders/create';
  const url = BASE_URL + path;
  const body = {
    symbol,
    side: 'SELL',
    type: 'MARKET',
    amount
  };
  try {
    const headers = signRequest('POST', path, null, body);
    const res = await axios.post(url, body, { headers });
    op.status = (res.data && (res.data.success || res.data.code === 'A10000')) ? 'success' : 'failed';
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

module.exports = {
  buy,
  sell
}; 