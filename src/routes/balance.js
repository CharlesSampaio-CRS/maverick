const { balanceHandler, balanceCurrencyHandler } = require('../controllers/balanceController');

const balanceRoutes = async (fastify, opts) => {
  fastify.get('/balance', {
    schema: {
      summary: 'Get balance of all currencies',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              currency: { type: 'string' },
              available: { type: 'string' },
              frozen: { type: 'string' },
              total: { type: 'string' }
            }
          }
        }
      }
    }
  }, balanceHandler);

  fastify.get('/balance/:currency', {
    schema: {
      summary: 'Get balance of specific currency',
      params: {
        type: 'object',
        properties: {
          currency: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            currency: { type: 'string' },
            available: { type: 'string' },
            frozen: { type: 'string' },
            total: { type: 'string' }
          }
        }
      }
    }
  }, balanceCurrencyHandler);
};

module.exports = balanceRoutes; 