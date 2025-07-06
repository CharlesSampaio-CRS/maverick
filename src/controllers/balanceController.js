const balanceService = require('../services/balanceService');

async function balanceHandler(request, reply) {
  try {
    const result = await balanceService.getAll();
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: 'Erro ao obter saldo', details: err.message });
  }
}

async function balanceCurrencyHandler(request, reply) {
  const { currency } = request.params;
  if (!currency) {
    return reply.status(400).send({ error: 'Parâmetro currency obrigatório' });
  }
  try {
    const result = await balanceService.getByCurrency(currency);
    if (!result || !result.currency) {
      return reply.status(404).send({ error: 'Moeda não encontrada' });
    }
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: 'Erro ao obter saldo da moeda', details: err.message });
  }
}

module.exports = {
  balanceHandler,
  balanceCurrencyHandler
}; 