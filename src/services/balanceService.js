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
  const res = await axios.get(url, { headers });
  return res.data;
}

async function getByCurrency(currency) {
  const all = await getAll();
  if (all && all.data) {
    const wallet = all.data.find(w => w.currency.toUpperCase() === currency.toUpperCase());
    return wallet || { currency, available: 0 };
  }
  return { currency, available: 0 };
}

module.exports = {
  getAll,
  getByCurrency
}; 