const ordersRoutes = async (fastify, opts) => {
  fastify.post('/buy', {
    schema: {
      summary: 'Criar ordem de compra a mercado',
      body: {
        type: 'object',
        required: ['symbol', 'amount'],
        properties: {
          symbol: { type: 'string' },
          amount: { type: 'number' }
        }
      },
      response: { 200: { type: 'object' } }
    }
  }, async (request, reply) => {
    // A lógica real ficará no server.js por enquanto
    return fastify.buyHandler(request, reply);
  });

  fastify.post('/sell', {
    schema: {
      summary: 'Criar ordem de venda a mercado',
      body: {
        type: 'object',
        required: ['symbol', 'amount'],
        properties: {
          symbol: { type: 'string' },
          amount: { type: 'number' }
        }
      },
      response: { 200: { type: 'object' } }
    }
  }, async (request, reply) => {
    return fastify.sellHandler(request, reply);
  });

  fastify.get('/operations/history', {
    schema: { summary: 'Histórico de operações', response: { 200: { type: 'array', items: { type: 'object' } } } }
  }, async (request, reply) => {
    const history = await Operation.find().sort({ createdAt: -1 }).limit(100);
    return reply.send(history);
  });
};

module.exports = ordersRoutes; 