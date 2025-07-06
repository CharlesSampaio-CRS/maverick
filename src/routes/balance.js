const balanceRoutes = async (fastify, opts) => {
  fastify.get('/balance', {
    schema: {
      summary: 'Obter saldo de todas as moedas',
      response: { 200: { type: 'object' } }
    }
  }, async (request, reply) => {
    return fastify.balanceHandler(request, reply);
  });

  fastify.get('/balance/:currency', {
    schema: {
      summary: 'Obter saldo de moeda específica',
      params: {
        type: 'object',
        properties: {
          currency: { type: 'string' }
        }
      },
      response: { 200: { type: 'object' } }
    }
  }, async (request, reply) => {
    return fastify.balanceCurrencyHandler(request, reply);
  });
};

module.exports = balanceRoutes; 