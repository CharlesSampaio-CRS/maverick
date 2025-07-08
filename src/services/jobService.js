const { JobConfig, GlobalConfig } = require('../models/JobConfig');
const cacheService = require('./cacheService');

async function status() {
  return await cacheService.getJobConfig();
}

async function updateConfig(body) {
  // Se o body tem symbol, é um símbolo individual
  if (body.symbol) {
    // Verificar se já existe configuração para este símbolo
    let symbolConfig = await JobConfig.findOne({ symbol: body.symbol });
    
    if (symbolConfig) {
      // Atualizar configuração existente
      symbolConfig.buyThreshold = body.buyThreshold;
      symbolConfig.sellThreshold = body.sellThreshold;
      symbolConfig.enabled = body.enabled !== undefined ? body.enabled : symbolConfig.enabled;
      symbolConfig.checkInterval = body.checkInterval || symbolConfig.checkInterval;
      symbolConfig.sellStrategy = body.sellStrategy || symbolConfig.sellStrategy;
      symbolConfig.updatedAt = new Date();
    } else {
      // Criar nova configuração
      symbolConfig = new JobConfig({
        symbol: body.symbol,
        buyThreshold: body.buyThreshold,
        sellThreshold: body.sellThreshold,
        enabled: body.enabled !== undefined ? body.enabled : true,
        checkInterval: body.checkInterval || '*/30 * * * *',
        sellStrategy: body.sellStrategy || 'security'
      });
    }
    
    await symbolConfig.save();
    // Invalidate cache after update
    cacheService.invalidateJobConfig();
    return await status();
  }

  // Se não tem symbol, é uma atualização global
  let globalConfig = await GlobalConfig.findOne();
  if (!globalConfig) {
    globalConfig = new GlobalConfig();
  }

  globalConfig.enabled = body.enabled !== undefined ? body.enabled : globalConfig.enabled;
  globalConfig.checkInterval = body.checkInterval || globalConfig.checkInterval;
  globalConfig.minVolume24h = body.minVolume24h || globalConfig.minVolume24h;
  globalConfig.cooldownMinutes = body.cooldownMinutes || globalConfig.cooldownMinutes;
  globalConfig.updatedAt = new Date();

  await globalConfig.save();
  // Invalidate cache after update
  cacheService.invalidateJobConfig();
  return await status();
}

async function toggleSymbol(symbol) {
  const symbolConfig = await JobConfig.findOne({ symbol });
  if (!symbolConfig) {
    throw new Error('Symbol not found');
  }
  
  symbolConfig.enabled = !symbolConfig.enabled;
  symbolConfig.updatedAt = new Date();
  await symbolConfig.save();
  
  // Invalidate cache after update
  cacheService.invalidateJobConfig();
  return await status();
}

async function removeSymbol(symbol) {
  const result = await JobConfig.deleteOne({ symbol });
  if (result.deletedCount === 0) {
    throw new Error('Symbol not found');
  }
  
  // Invalidate cache after update
  cacheService.invalidateJobConfig();
  return await status();
}

async function addSymbol(body) {
  if (!body.symbol) throw new Error('Symbol is required');
  
  const exists = await JobConfig.findOne({ symbol: body.symbol });
  if (exists) throw new Error('Symbol already exists');
  
  const symbolConfig = new JobConfig({
    symbol: body.symbol,
    buyThreshold: body.buyThreshold,
    sellThreshold: body.sellThreshold,
    enabled: body.enabled !== undefined ? body.enabled : true,
    sellStrategy: body.sellStrategy || 'security'
  });
  
  await symbolConfig.save();
  
  // Invalidate cache after update
  cacheService.invalidateJobConfig();
  return await status();
}

async function updateSymbol(symbol, body) {
  const symbolConfig = await JobConfig.findOne({ symbol });
  if (!symbolConfig) {
    throw new Error('Symbol not found');
  }
  
  symbolConfig.buyThreshold = body.buyThreshold !== undefined ? body.buyThreshold : symbolConfig.buyThreshold;
  symbolConfig.sellThreshold = body.sellThreshold !== undefined ? body.sellThreshold : symbolConfig.sellThreshold;
  symbolConfig.enabled = body.enabled !== undefined ? body.enabled : symbolConfig.enabled;
  symbolConfig.sellStrategy = body.sellStrategy || symbolConfig.sellStrategy;
  symbolConfig.updatedAt = new Date();
  
  await symbolConfig.save();
  
  // Invalidate cache after update
  cacheService.invalidateJobConfig();
  return await status();
}

async function getSymbol(symbol) {
  const symbolConfig = await JobConfig.findOne({ symbol }).lean();
  if (!symbolConfig) {
    throw new Error('Symbol not found');
  }
  return symbolConfig;
}

module.exports = {
  status,
  updateConfig,
  toggleSymbol,
  removeSymbol,
  addSymbol,
  updateSymbol,
  getSymbol
}; 