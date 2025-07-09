const axios = require('axios');
const cacheService = require('./cacheService');
const API_KEY = process.env.NOVADAX_API_KEY;
const API_SECRET = process.env.NOVADAX_API_SECRET;
const BASE_URL = 'https://api.novadax.com';

// HTTP client with timeout and retry configuration
const httpClient = axios.create({
  timeout: 10000, // 10 seconds timeout for balance calls
  maxRedirects: 3
});

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

/**
 * Obtém o saldo de uma moeda específica ou de todas as moedas.
 * Usa cache para otimizar chamadas.
 */
async function getBalance(currency = null) {
  // Check cache first
  const cached = cacheService.getBalance(currency);
  if (cached) {
    return cached;
  }

  const path = '/v1/account/getBalance';
  const url = BASE_URL + path;
  const headers = signRequest('GET', path);
  
  try {
    const res = await httpClient.get(url, { headers });
    if (res.data.code !== 'A10000') {
      throw new Error('Unexpected response from NovaDAX');
    }
    
    const balances = res.data.data;
    let result;
    
    if (currency) {
      result = balances.find(b => b.currency === currency) || { currency, available: '0', frozen: '0', total: '0' };
    } else {
      result = balances;
    }

    // Cache the result
    cacheService.setBalance(currency, result);
    
    return result;
  } catch (err) {
    console.error(`[BALANCE] Error fetching balance for ${currency || 'all'}:`, err.message);
    throw err;
  }
}

/**
 * Obtém saldos de múltiplas moedas de forma eficiente.
 */
async function getBalances(currencies) {
  const results = {};
  const uncachedCurrencies = [];
  
  // Check cache for each currency
  for (const currency of currencies) {
    const cached = cacheService.getBalance(currency);
    if (cached) {
      results[currency] = cached;
    } else {
      uncachedCurrencies.push(currency);
    }
  }
  
  // If we need to fetch some currencies, get all balances and extract what we need
  if (uncachedCurrencies.length > 0) {
    try {
      const allBalances = await getBalance(); // This will fetch and cache all balances
      
      // Extract the currencies we need
      uncachedCurrencies.forEach(currency => {
        const balance = allBalances.find(b => b.currency === currency);
        results[currency] = balance || { currency, available: '0', frozen: '0', total: '0' };
      });
    } catch (err) {
      // If fetching all balances fails, try individual currencies
      for (const currency of uncachedCurrencies) {
        try {
          results[currency] = await getBalance(currency);
        } catch (err) {
          results[currency] = { currency, available: '0', frozen: '0', total: '0', error: err.message };
        }
      }
    }
  }
  
  return results;
}

/**
 * Invalida o cache de saldo (útil após trades).
 */
function invalidateBalanceCache() {
  cacheService.invalidateBalance();
}

module.exports = {
  getBalance,
  getBalances,
  invalidateBalanceCache
}; 