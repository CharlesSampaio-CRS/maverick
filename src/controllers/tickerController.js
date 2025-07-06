const tickerService = require('../services/tickerService');

async function tickerHandler(request, reply) {
  const { symbol } = request.params;
  if (!symbol) {
    return reply.status(400).send({ error: 'Parâmetro symbol obrigatório' });
  }
  try {
    const result = await tickerService.get(symbol);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: 'Erro ao obter ticker', details: err.message });
  }
}

module.exports = {
  tickerHandler
}; 