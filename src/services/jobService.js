const Config = require('../models/Config');

async function getJobConfig() {
  let config = await Config.findOne({ key: 'job_config' });
  if (!config) {
    config = await Config.create({
      key: 'job_config',
      value: {
        enabled: true,
        checkInterval: '*/3 * * * *',
        symbols: []
      }
    });
  }
  return config.value;
}

async function setJobConfig(newValue) {
  const config = await Config.findOneAndUpdate(
    { key: 'job_config' },
    { value: newValue, updatedAt: new Date() },
    { new: true, upsert: true }
  );
  return config.value;
}

async function status() {
  return await getJobConfig();
}

async function config(body) {
  if (
    typeof body.enabled !== 'boolean' ||
    typeof body.checkInterval !== 'string' ||
    !Array.isArray(body.symbols)
  ) {
    throw new Error('Parâmetros obrigatórios: enabled (boolean), checkInterval (string), symbols (array)');
  }
  return await setJobConfig(body);
}

async function toggle(symbol) {
  const current = await getJobConfig();
  const idx = current.symbols.findIndex(s => s.symbol === symbol);
  if (idx === -1) throw new Error('Símbolo não encontrado');
  current.symbols[idx].enabled = !current.symbols[idx].enabled;
  return await setJobConfig(current);
}

async function addSymbol(body) {
  const current = await getJobConfig();
  if (!body.symbol) throw new Error('Símbolo obrigatório');
  if (current.symbols.find(s => s.symbol === body.symbol)) {
    throw new Error('Símbolo já existe');
  }
  current.symbols.push(body);
  return await setJobConfig(current);
}

async function removeSymbol(symbol) {
  const current = await getJobConfig();
  current.symbols = current.symbols.filter(s => s.symbol !== symbol);
  return await setJobConfig(current);
}

async function updateSymbol(symbol, body) {
  const current = await getJobConfig();
  const idx = current.symbols.findIndex(s => s.symbol === symbol);
  if (idx === -1) throw new Error('Símbolo não encontrado');
  current.symbols[idx] = { ...current.symbols[idx], ...body };
  return await setJobConfig(current);
}

async function getSymbol(symbol) {
  const current = await getJobConfig();
  const found = current.symbols.find(s => s.symbol === symbol);
  if (!found) throw new Error('Símbolo não encontrado');
  return found;
}

async function statusDetailed() {
  // Para exemplo, retorna o mesmo que status
  return await getJobConfig();
}

module.exports = {
  status,
  config,
  toggle,
  addSymbol,
  removeSymbol,
  updateSymbol,
  getSymbol,
  statusDetailed
}; 