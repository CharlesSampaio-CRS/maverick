const ordersService = require('../services/ordersService');
const priceTrackingService = require('../services/priceTrackingService');
const { JobConfig } = require('../models/JobConfig');
const sellStrategies = require('../utils/sellStrategies');

/**
 * Manual buy and sell handlers.
 *
 * IMPORTANT:
 * The threshold protection rules (only buy if sellThreshold is negative, only sell if buyThreshold is positive)
 * ONLY apply to the automatic job (automated execution).
 *
 * Manual operations (buy/sell through these handlers) are NOT blocked by these rules.
 * The user can buy or sell manually at any price.
 */
async function buyHandler(request, reply) {
  const { symbol } = request.body;
  if (!symbol) {
    return reply.status(400).send({ error: 'Symbol is required' });
  }
  try {
    // Buscar config do símbolo para saber a estratégia
    const config = await JobConfig.findOne({ symbol });
    const strategy = config ? config.sellStrategy : undefined;
    const result = await ordersService.createBuyOrder(symbol);
    if (result.status === 'success' && result._id) {
      const Operation = require('../models/Operation');
      const valueBRL = result.amount ? Number(result.amount) : null;
      await Operation.updateOne(
        { _id: result._id },
        { $set: {
            strategy: strategy,
            amount: result.amount,
            price: result.price, // já vem do ticker
            valueBRL,
            typeOperation: 'manual'
          }
        }
      );
      // Atualizar lastBuyPrice no JobConfig
      await JobConfig.updateOne(
        { symbol },
        { $set: { lastBuyPrice: result.price, updatedAt: new Date() } }
      );
      // Resetar tracker de venda/compra para liberar novas operações
      try {
        const { partialSales } = require('./jobController');
        if (partialSales && partialSales.delete) partialSales.delete(symbol);
      } catch (e) { /* ignora se não conseguir importar */ }
      // Now update the tracking
      await priceTrackingService.updatePriceTracking(symbol);
    }
    // Value in BRL for buy is the amount itself
    // Salvar/atualizar Operation com strategy, amount, price e valueBRL
    // (já feito acima)
    return reply.send({
      ...result,
      strategy: strategy,
      amount: result.amount,
      price: result.price,
      valueBRL
    });
  } catch (err) {
    return reply.status(500).send({ error: 'Error creating order', details: err.message });
  }
}

/**
 * Handler for manual sell. Validates symbol, executes order, and updates tracking.
 */
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
    // Find available balance
    const baseCurrency = symbol.split('_')[0];
    const balanceService = require('../services/balanceService');
    const balance = await balanceService.getBalance(baseCurrency);
    const available = parseFloat(balance.available);
    if (available <= 0) {
      return reply.status(400).send({ error: 'No balance available to sell' });
    }
    // Find already executed sells (Operation)
    const Operation = require('../models/Operation');
    const sells = await Operation.find({ symbol, type: 'sell', status: 'success' }).sort({ createdAt: 1 });
    // For manual sell, always allow selling 100% of available balance
    let amount = Math.floor(available);
    if (amount <= 0) {
      return reply.status(400).send({ error: 'Calculated sell amount is zero, cannot execute order.' });
    }
    // Execute sell
    const result = await ordersService.createSellOrder(symbol, amount);
    // Update price tracking after successful sell
    if (result.status === 'success') {
      await priceTrackingService.updatePriceTracking(symbol);
      // Atualizar lastSellPrice no JobConfig
      await JobConfig.updateOne(
        { symbol },
        { $set: { lastSellPrice: result.price, updatedAt: new Date() } }
      );
      // Resetar tracker de venda/compra para liberar novas operações
      try {
        const { partialSales } = require('./jobController');
        if (partialSales && partialSales.delete) partialSales.delete(symbol);
      } catch (e) { /* ignora se não conseguir importar */ }
      // Mark operation as manual
      if (result._id) {
        await Operation.updateOne(
          { _id: result._id },
          { $set: { typeOperation: 'manual' } }
        );
      }
    }
    // Value in BRL for sell is amount * price
    const valueBRL = (result.amount && result.price) ? Number(result.amount) * Number(result.price) : null;
    // Salvar/atualizar Operation com strategy, amount, price e valueBRL
    if (result._id) {
      await Operation.updateOne(
        { _id: result._id },
        { $set: { strategy: strategy, amount: result.amount, price: result.price, valueBRL } }
      );
    }
    return reply.send({
      ...result,
      strategy: strategy,
      amount: result.amount,
      price: result.price,
      valueBRL,
      level: 1,
      percentage: 1,
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