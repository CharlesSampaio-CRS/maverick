const tickerRoutes = async (fastify, opts) => {
  fastify.get('/ticker/:symbol', {
    schema: {
      summary: 'Obter dados de preço e variação de um símbolo',
      params: {
        type: 'object',
        properties: {
          symbol: { type: 'string' }
        }
      },
      response: { 200: { type: 'object' } }
    }
  }, async (request, reply) => {
    return fastify.tickerHandler(request, reply);
  });
};

module.exports = tickerRoutes; 