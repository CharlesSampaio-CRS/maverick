const balanceService = require('../services/balanceService');

async function balanceHandler(request, reply) {
  const result = await balanceService.getAll();
  if (!result.success) {
    return reply.status(500).send({ error: result.error, details: result.details });
  }
  return reply.send(result.balances);
}

async function balanceCurrencyHandler(request, reply) {
  const { currency } = request.params;
  if (!currency) {
    return reply.status(400).send({ error: 'Parâmetro currency obrigatório' });
  }
  const result = await balanceService.getByCurrency(currency);
  if (result.success === false) {
    return reply.status(500).send({ error: result.error, details: result.details });
  }
  if (!result || !result.currency) {
    return reply.status(404).send({ error: 'Moeda não encontrada' });
  }
  return reply.send(result);
}

module.exports = {
  balanceHandler,
  balanceCurrencyHandler
}; 