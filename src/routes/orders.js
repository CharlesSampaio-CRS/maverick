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
              type: { type: 'string', description: 'Tipo da operação (buy/sell)', enum: ['buy', 'sell'] },
              amount: { type: 'number', description: 'Quantidade da operação' },
              price: { type: 'number', description: 'Preço da operação' },
              status: { type: 'string', description: 'Status da operação', default: 'pending' },
              response: { 
                type: 'object', 
                description: 'Resposta da exchange',
                properties: {
                  code: { type: 'string', description: 'Código de resposta da exchange' },
                  message: { type: 'string', description: 'Mensagem de resposta da exchange' },
                  data: { 
                    type: 'object', 
                    description: 'Dados da ordem',
                    properties: {
                      amount: { type: 'string', description: 'Quantidade da ordem' },
                      feeCurrency: { type: 'string', description: 'Moeda da taxa' },
                      filledAmount: { type: 'string', description: 'Quantidade preenchida' },
                      filledValue: { type: 'string', description: 'Valor preenchido' },
                      id: { type: 'string', description: 'ID da ordem na exchange' },
                      price: { type: 'string', description: 'Preço da ordem' },
                      side: { type: 'string', description: 'Lado da ordem (BUY/SELL)' },
                      status: { type: 'string', description: 'Status da ordem na exchange' },
                      symbol: { type: 'string', description: 'Símbolo da ordem' },
                      timestamp: { type: 'number', description: 'Timestamp da ordem' },
                      type: { type: 'string', description: 'Tipo da ordem (MARKET/LIMIT)' },
                      value: { type: 'string', description: 'Valor da ordem' }
                    }
                  }
                }
              },
              buyPrice: { type: 'number', description: 'Preço de compra (para vendas)' },
              profit: { type: 'number', description: 'Lucro/prejuízo da operação' },
              createdAt: { type: 'string', format: 'date-time', description: 'Data de criação' },
              __v: { type: 'number', description: 'Versão do documento MongoDB' },
              value: { type: 'number', description: 'Valor em BRL (apenas para compras)' }
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