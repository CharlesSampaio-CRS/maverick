const ordersService = require('../services/ordersService');
const priceTrackingService = require('../services/priceTrackingService');

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
  const { symbol, amount } = request.body;
  if (!symbol || typeof amount !== 'number' || amount <= 0) {
    return reply.status(400).send({ error: 'Invalid parameters' });
  }
  try {
    const result = await ordersService.createSellOrder(symbol, amount);
    // Atualiza o tracking de preço após venda bem-sucedida
    if (result.status === 'success') {
      await priceTrackingService.updatePriceTracking(symbol);
    }
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: 'Error creating order', details: err.message });
  }
}

module.exports = {
  buyHandler,
  sellHandler
}; 