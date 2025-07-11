const { buyHandler, sellHandler } = require('../controllers/ordersController');
const Operation = require('../models/Operation');

const ordersRoutes = async (fastify, opts) => {
  fastify.post('/buy', {
    schema: {
      tags: ['Orders'],
      summary: 'Create market buy order',
      description: 'Cria uma ordem de compra a mercado para o símbolo especificado.',
      body: {
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
            _id: { type: 'string', description: 'ID da operação' },
            symbol: { type: 'string', description: 'Símbolo da moeda' },
            type: { type: 'string', description: 'Tipo da operação (buy)' },
            amount: { type: 'number', description: 'Quantidade comprada' },
            price: { type: 'number', description: 'Preço da compra' },
            status: { type: 'string', description: 'Status da operação' },
            response: { type: 'object', description: 'Resposta da exchange' },
            createdAt: { type: 'string', description: 'Data de criação' }
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
  }, buyHandler);

  fastify.post('/sell', {
    schema: {
      tags: ['Orders'],
      summary: 'Create market sell order',
      description: 'Cria uma ordem de venda a mercado para o símbolo especificado.',
      body: {
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
            _id: { type: 'string', description: 'ID da operação' },
            symbol: { type: 'string', description: 'Símbolo da moeda' },
            type: { type: 'string', description: 'Tipo da operação (sell)' },
            amount: { type: 'number', description: 'Quantidade vendida' },
            price: { type: 'number', description: 'Preço da venda' },
            status: { type: 'string', description: 'Status da operação' },
            response: { type: 'object', description: 'Resposta da exchange' },
            createdAt: { type: 'string', description: 'Data de criação' }
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
  }, sellHandler);

  fastify.get('/operations/history', {
    schema: {
      tags: ['Orders'],
      summary: 'Operations history',
      description: 'Retorna o histórico das últimas 100 operações realizadas.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              _id: { type: 'string', description: 'ID da operação' },
              symbol: { type: 'string', description: 'Símbolo da moeda' },
              type: { type: 'string', description: 'Tipo da operação (buy/sell)' },
              amount: { type: 'number', description: 'Quantidade (para vendas)' },
              value: { type: 'number', description: 'Valor em BRL (para compras)' },
              price: { type: 'number', description: 'Preço da operação' },
              status: { type: 'string', description: 'Status da operação' },
              response: { type: 'object', description: 'Resposta da exchange' },
              createdAt: { type: 'string', description: 'Data de criação' }
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