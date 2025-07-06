const tickerService = require('../services/tickerService');

async function tickerHandler(request, reply) {
  const { symbol } = request.params;
  if (!symbol) {
    return reply.status(400).send({ error: 'Symbol parameter is required' });
  }
  
  try {
    const result = await tickerService.getTicker(symbol);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

module.exports = {
  tickerHandler
}; 