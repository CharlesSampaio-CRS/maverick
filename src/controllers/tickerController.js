const tickerService = require('../services/tickerService');

async function tickerHandler(request, reply) {
  const { symbol } = request.params;
  if (!symbol) {
    return reply.status(400).send({ error: 'Parâmetro symbol obrigatório' });
  }
  const result = await tickerService.get(symbol);
  if (!result.success) {
    return reply.status(500).send({ error: result.error, details: result.details });
  }
  return reply.send(result);
}

module.exports = {
  tickerHandler
}; 