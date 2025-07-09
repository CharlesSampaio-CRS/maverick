const { tickerHandler } = require('../controllers/tickerController');

const tickerRoutes = async (fastify, opts) => {
  fastify.get('/ticker/:symbol', {
    schema: {
      tags: ['Prices'],
      summary: 'Get price and variation data for a symbol',
      params: {
        type: 'object',
        properties: {
          symbol: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            symbol: { type: 'string' },
            lastPrice: { type: 'string' },
            bid: { type: 'string' },
            ask: { type: 'string' },
            high24h: { type: 'string' },
            low24h: { type: 'string' },
            open24h: { type: 'string' },
            baseVolume24h: { type: 'string' },
            quoteVolume24h: { type: 'string' },
            change24h: { type: 'string' },
            changePercent24h: { type: 'string' },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, tickerHandler);
};

module.exports = tickerRoutes; 