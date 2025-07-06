const balanceService = require('../services/balanceService');

async function balanceHandler(request, reply) {
  try {
    const balances = await balanceService.getBalance();
    return reply.send(balances);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

async function balanceCurrencyHandler(request, reply) {
  const { currency } = request.params;
  if (!currency) {
    return reply.status(400).send({ error: 'Currency parameter is required' });
  }
  try {
    const balance = await balanceService.getBalance(currency);
    if (!balance || !balance.currency) {
      return reply.status(404).send({ error: 'Currency not found' });
    }
    return reply.send(balance);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

module.exports = {
  balanceHandler,
  balanceCurrencyHandler
}; 