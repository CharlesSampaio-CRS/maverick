const axios = require('axios');
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

async function getAll() {
  const path = '/v1/account/getBalance';
  const url = BASE_URL + path;
  const headers = signRequest('GET', path);
  try {
    const res = await axios.get(url, { headers });
    console.log('NovaDAX balance response:', res.data);
    if (!res.data || !res.data.data) {
      throw new Error('Resposta inesperada da NovaDAX');
    }
    // Filtra apenas moedas com saldo > 0
    const filtered = res.data.data.filter(w => (parseFloat(w.available) || 0) + (parseFloat(w.frozen) || 0) > 0);
    return { success: true, balances: filtered };
  } catch (err) {
    console.error('Erro ao consultar saldo NovaDAX:', err.response?.data || err.message);
    return { success: false, error: 'Erro ao consultar saldo NovaDAX', details: err.response?.data || err.message };
  }
}

async function getByCurrency(currency) {
  const all = await getAll();
  if (!all.success) return all;
  const wallet = all.balances.find(w => w.currency.toUpperCase() === currency.toUpperCase());
  return wallet || { currency, available: 0 };
}

module.exports = {
  getAll,
  getByCurrency
}; 