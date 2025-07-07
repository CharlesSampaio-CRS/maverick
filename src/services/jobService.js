const JobConfig = require('../models/JobConfig');

async function status() {
  let config = await JobConfig.findOne();
  if (!config) {
    config = new JobConfig({
      enabled: false,
      checkInterval: '*/3 * * * *',
      symbols: [],
      minVolume24h: 1000000,
      cooldownMinutes: 30
    });
    await config.save();
  }
  return config;
}

async function updateConfig(body) {
  if (body.enabled === undefined ||
      !body.checkInterval ||
      !body.symbols ||
      !Array.isArray(body.symbols)) {
    throw new Error('Required parameters: enabled (boolean), checkInterval (string), symbols (array)');
  }

  let config = await JobConfig.findOne();
  if (!config) {
    config = new JobConfig();
  }

  config.enabled = body.enabled;
  config.checkInterval = body.checkInterval;
  config.symbols = body.symbols;
  config.minVolume24h = body.minVolume24h || 1000000;
  config.cooldownMinutes = body.cooldownMinutes || 30;

  await config.save();
  return config;
}

async function toggleSymbol(symbol) {
  const config = await status();
  const idx = config.symbols.findIndex(s => s.symbol === symbol);
  if (idx === -1) throw new Error('Symbol not found');
  
  config.symbols[idx].enabled = !config.symbols[idx].enabled;
  await config.save();
  return config;
}

async function addSymbol(body) {
  if (!body.symbol) throw new Error('Symbol is required');
  
  const config = await status();
  const exists = config.symbols.find(s => s.symbol === body.symbol);
  if (exists) throw new Error('Symbol already exists');
  
  config.symbols.push(body);
  await config.save();
  return config;
}

async function removeSymbol(symbol) {
  const config = await status();
  const idx = config.symbols.findIndex(s => s.symbol === symbol);
  if (idx === -1) throw new Error('Symbol not found');
  
  config.symbols.splice(idx, 1);
  await config.save();
  return config;
}

async function updateSymbol(symbol, body) {
  const config = await status();
  const idx = config.symbols.findIndex(s => s.symbol === symbol);
  if (idx === -1) throw new Error('Symbol not found');
  
  config.symbols[idx] = { ...config.symbols[idx], ...body };
  await config.save();
  return config;
}

async function getSymbol(symbol) {
  const config = await status();
  const found = config.symbols.find(s => s.symbol === symbol);
  if (!found) throw new Error('Symbol not found');
  return found;
}

module.exports = {
  status,
  updateConfig,
  toggleSymbol,
  addSymbol,
  removeSymbol,
  updateSymbol,
  getSymbol
}; 