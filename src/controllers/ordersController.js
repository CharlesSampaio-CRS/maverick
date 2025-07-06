const ordersService = require('../services/ordersService');

async function buyHandler(request, reply) {
  const { symbol, amount } = request.body;
  if (!symbol || typeof amount !== 'number' || amount <= 0) {
    return reply.status(400).send({ error: 'Parâmetros inválidos' });
  }
  try {
    const result = await ordersService.buy(symbol, amount);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: 'Erro ao criar ordem', details: err.message });
  }
}

async function sellHandler(request, reply) {
  const { symbol, amount } = request.body;
  if (!symbol || typeof amount !== 'number' || amount <= 0) {
    return reply.status(400).send({ error: 'Parâmetros inválidos' });
  }
  try {
    const result = await ordersService.sell(symbol, amount);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: 'Erro ao criar ordem', details: err.message });
  }
}

module.exports = {
  buyHandler,
  sellHandler
}; 