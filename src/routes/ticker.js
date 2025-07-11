const { tickerHandler } = require('../controllers/tickerController');

const tickerRoutes = async (fastify, opts) => {
  fastify.get('/ticker/:symbol', {
    schema: {
      tags: ['Prices'],
      summary: 'Get price and variation data for a symbol',
      description: 'Retorna dados de preço e variação para um símbolo específico.',
      params: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: { type: 'string', description: 'Símbolo da moeda (ex: BTC_BRL)' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean', description: 'Se a requisição foi bem-sucedida' },
            symbol: { type: 'string', description: 'Símbolo da moeda' },
            lastPrice: { type: 'string', description: 'Último preço negociado' },
            bid: { type: 'string', description: 'Melhor preço de compra' },
            ask: { type: 'string', description: 'Melhor preço de venda' },
            high24h: { type: 'string', description: 'Maior preço nas últimas 24h' },
            low24h: { type: 'string', description: 'Menor preço nas últimas 24h' },
            open24h: { type: 'string', description: 'Preço de abertura há 24h' },
            baseVolume24h: { type: 'string', description: 'Volume da moeda base nas últimas 24h' },
            quoteVolume24h: { type: 'string', description: 'Volume da moeda quote nas últimas 24h' },
            change24h: { type: 'string', description: 'Variação absoluta nas últimas 24h' },
            changePercent24h: { type: 'string', description: 'Variação percentual nas últimas 24h' },
            timestamp: { type: 'number', description: 'Timestamp da última atualização' }
          }
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Mensagem de erro' }
          }
        },
        500: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Mensagem de erro' }
          }
        }
      }
    }
  }, tickerHandler);
};

module.exports = tickerRoutes; 