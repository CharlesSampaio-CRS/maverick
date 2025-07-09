const ordersService = require('../services/ordersService');
const priceTrackingService = require('../services/priceTrackingService');
const jobService = require('../services/jobService');
const { JobConfig } = require('../models/JobConfig');

// Estratégias de venda parametrizadas (copiado do jobController)
const sellStrategies = {
  security: {
    levels: [
      { percentage: 0.3, priceIncrease: 0 },
      { percentage: 0.3, priceIncrease: 0.05 },
      { percentage: 0.2, priceIncrease: 0.10 },
      { percentage: 0.2, priceIncrease: 0.15 }
    ]
  },
  basic: {
    levels: [
      { percentage: 0.4, priceIncrease: 0 },
      { percentage: 0.3, priceIncrease: 0.05 },
      { percentage: 0.3, priceIncrease: 0.10 }
    ]
  },
  aggressive: {
    levels: [
      { percentage: 1.0, priceIncrease: 0 }
    ]
  }
};

async function buyHandler(request, reply) {
  const { symbol } = request.body;
  if (!symbol) {
    return reply.status(400).send({ error: 'Symbol is required' });
  }
  try {
    const result = await ordersService.createBuyOrder(symbol);
    // Atualiza o tracking de preço após compra bem-sucedida
    if (result.status === 'success') {
      await priceTrackingService.updatePriceTracking(symbol);
    }
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: 'Error creating order', details: err.message });
  }
}

async function sellHandler(request, reply) {
  const { symbol } = request.body;
  if (!symbol) {
    return reply.status(400).send({ error: 'Symbol is required' });
  }
  try {
    // Buscar config do símbolo
    const config = await JobConfig.findOne({ symbol });
    if (!config) {
      return reply.status(404).send({ error: 'Symbol config not found' });
    }
    const strategy = config.sellStrategy || 'security';
    const strategyConfig = sellStrategies[strategy];
    if (!strategyConfig) {
      return reply.status(400).send({ error: 'Invalid sell strategy for symbol' });
    }
    // Buscar saldo disponível
    const baseCurrency = symbol.split('_')[0];
    const balanceService = require('../services/balanceService');
    const balance = await balanceService.getBalance(baseCurrency);
    const available = parseFloat(balance.available);
    if (available <= 0) {
      return reply.status(400).send({ error: 'No balance available to sell' });
    }
    // Buscar vendas já realizadas (Operation)
    const Operation = require('../models/Operation');
    const sells = await Operation.find({ symbol, type: 'sell', status: 'success' }).sort({ createdAt: 1 });
    // Descobrir qual nível da estratégia é o próximo
    let levelIdx = sells.length;
    if (levelIdx >= strategyConfig.levels.length) {
      return reply.status(400).send({ error: 'All strategy levels already executed for this symbol' });
    }
    const level = strategyConfig.levels[levelIdx];
    const amount = Math.floor(available * level.percentage);
    if (amount <= 0) {
      return reply.status(400).send({ error: 'Calculated sell amount is zero, cannot execute order.' });
    }
    // Executar venda
    const result = await ordersService.createSellOrder(symbol, amount);
    // Atualiza o tracking de preço após venda bem-sucedida
    if (result.status === 'success') {
      await priceTrackingService.updatePriceTracking(symbol);
    }
    return reply.send({
      ...result,
      strategy: strategy,
      level: levelIdx + 1,
      percentage: level.percentage,
      amountUsed: amount
    });
  } catch (err) {
    return reply.status(500).send({ error: 'Error creating order', details: err.message });
  }
}

module.exports = {
  buyHandler,
  sellHandler
}; 