const axios = require('axios');
const API_KEY = process.env.NOVADAX_API_KEY;
const API_SECRET = process.env.NOVADAX_API_SECRET;
const BASE_URL = 'https://api.novadax.com';

function signRequest(method, path, query = '', body = null) {
  const timestamp = Date.now();
  let signStr;
  
  if (method === 'GET') {
    const sortedQuery = query.split('&').sort().join('&');
    signStr = `${method}\n${path}\n${sortedQuery}\n${timestamp}`;
  } else {
    const content = JSON.stringify(body);
    const md5Hash = require('crypto').createHash('md5').update(content).digest('hex');
    signStr = `${method}\n${path}\n${md5Hash}\n${timestamp}`;
  }
  
  const signature = require('crypto')
    .createHmac('sha256', API_SECRET)
    .update(signStr)
    .digest('hex');
  const headers = {
    'X-Nova-Access-Key': API_KEY,
    'X-Nova-Signature': signature,
    'X-Nova-Timestamp': timestamp
  };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  return headers;
}

async function getBalance(currency = null) {
  const path = '/v1/account/getBalance';
  const url = BASE_URL + path;
  const headers = signRequest('GET', path);
  
  try {
    const res = await axios.get(url, { headers });
    if (res.data.code !== 'A10000') {
      throw new Error('Unexpected response from NovaDAX');
    }
    
    const balances = res.data.data;
    if (currency) {
      return balances.find(b => b.currency === currency) || { currency, available: '0', frozen: '0', total: '0' };
    }
    return balances;
  } catch (err) {
    throw err;
  }
}

module.exports = {
  getBalance
}; 