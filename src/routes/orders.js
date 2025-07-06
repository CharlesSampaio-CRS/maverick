const { buyHandler, sellHandler } = require('../controllers/ordersController');
const Operation = require('../models/Operation');

const ordersRoutes = async (fastify, opts) => {
  fastify.post('/buy', {
    schema: {
      summary: 'Create market buy order',
      body: {
        type: 'object',
        required: ['symbol', 'amount'],
        properties: {
          symbol: { type: 'string' },
          amount: { type: 'number' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            symbol: { type: 'string' },
            type: { type: 'string' },
            amount: { type: 'number' },
            price: { type: 'number' },
            status: { type: 'string' },
            response: { type: 'object' },
            createdAt: { type: 'string' }
          }
        }
      }
    }
  }, buyHandler);

  fastify.post('/sell', {
    schema: {
      summary: 'Create market sell order',
      body: {
        type: 'object',
        required: ['symbol', 'amount'],
        properties: {
          symbol: { type: 'string' },
          amount: { type: 'number' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            symbol: { type: 'string' },
            type: { type: 'string' },
            amount: { type: 'number' },
            price: { type: 'number' },
            status: { type: 'string' },
            response: { type: 'object' },
            createdAt: { type: 'string' }
          }
        }
      }
    }
  }, sellHandler);

  fastify.get('/operations/history', {
    schema: {
      summary: 'Operations history',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              symbol: { type: 'string' },
              type: { type: 'string' },
              amount: { type: 'number' },
              price: { type: 'number' },
              status: { type: 'string' },
              response: { type: 'object' },
              createdAt: { type: 'string' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const history = await Operation.find().sort({ createdAt: -1 }).limit(100);
    return reply.send(history);
  });
};

module.exports = ordersRoutes; 