const { buyHandler, sellHandler } = require('../controllers/ordersController');
const Operation = require('../models/Operation');

const ordersRoutes = async (fastify, opts) => {
  fastify.post('/buy', {
    schema: {
      tags: ['Orders'],
      summary: 'Create market buy order',
      body: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: { type: 'string' }
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
      tags: ['Orders'],
      summary: 'Create market sell order',
      body: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: { type: 'string' }
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
      tags: ['Orders'],
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
              value: { type: 'number' },
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
    
    // Transformar o atributo baseado no tipo de operação
    const transformedHistory = history.map(operation => {
      const transformed = operation.toObject();
      
      if (operation.type === 'buy') {
        // Para BUY: renomeia amount para value
        transformed.value = transformed.amount;
        delete transformed.amount;
      }
      // Para SELL: mantém amount como está
      
      return transformed;
    });
    
    return reply.send(transformedHistory);
  });
};

module.exports = ordersRoutes; 