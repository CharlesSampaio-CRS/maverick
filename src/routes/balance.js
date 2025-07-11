const { balanceHandler, balanceCurrencyHandler } = require('../controllers/balanceController');

const balanceRoutes = async (fastify, opts) => {
  fastify.get('/balance', {
    schema: {
      tags: ['Balance'],
      summary: 'Get balance of all currencies',
      description: 'Retorna o saldo de todas as moedas disponíveis na conta.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              currency: { type: 'string', description: 'Código da moeda' },
              available: { type: 'string', description: 'Saldo disponível para operações' },
              frozen: { type: 'string', description: 'Saldo congelado em ordens' },
              total: { type: 'string', description: 'Saldo total (disponível + congelado)' }
            }
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
  }, balanceHandler);

  fastify.get('/balance/:currency', {
    schema: {
      tags: ['Balance'],
      summary: 'Get balance of specific currency',
      description: 'Retorna o saldo de uma moeda específica.',
      params: {
        type: 'object',
        required: ['currency'],
        properties: {
          currency: { type: 'string', description: 'Código da moeda (ex: BRL, BTC, ETH)' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            currency: { type: 'string', description: 'Código da moeda' },
            available: { type: 'string', description: 'Saldo disponível para operações' },
            frozen: { type: 'string', description: 'Saldo congelado em ordens' },
            total: { type: 'string', description: 'Saldo total (disponível + congelado)' }
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
  }, balanceCurrencyHandler);
};

module.exports = balanceRoutes; 