const axios = require('axios');
const BASE_URL = 'https://api.novadax.com';

async function get(symbol) {
  const path = '/v1/market/ticker';
  const url = `${BASE_URL}${path}?symbol=${symbol}`;
  const res = await axios.get(url);
  return res.data;
}

module.exports = {
  get
}; 