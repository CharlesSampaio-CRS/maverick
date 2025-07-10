const {
  jobStatusHandler,
  jobToggleHandler,
  jobRunHandler,
  jobConfigHandler,
  jobRemoveSymbolHandler,
  jobGetSymbolHandler,
  jobStatusDetailedHandler,
  jobUpdateIntervalHandler,
  jobStrategyStatusHandler,
  getPriceStatsHandler,
  resetPriceTrackingHandler
} = require('../controllers/jobController');

const jobConfigSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string' },
    buyThreshold: { type: 'number' },
    sellThreshold: { type: 'number' },
    enabled: { type: 'boolean' },
    checkInterval: { type: 'string' },
    sellStrategy: { 
      type: 'string', 
      enum: ['security', 'basic', 'aggressive'],
      default: 'security'
    },
    minBuyPrice: { type: 'number' },
    maxSellPrice: { type: 'number' },
    priceTrackingEnabled: { type: 'boolean' },
    minProfitPercent: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    __v: { type: 'number' }
  }
};

const symbolBodySchema = {
  type: 'object',
  required: ['symbol'],
  properties: {
    symbol: { type: 'string' }
  }
};

const intervalSchema = {
  type: 'object',
  required: ['checkInterval'],
  properties: {
    checkInterval: { type: 'string' }
  }
};

const saleStrategyConfigSchema = {
  type: 'object',
  properties: {
    levels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          percentage: { type: 'number', minimum: 0, maximum: 1 },
          priceIncrease: { type: 'number', minimum: 0 }
        },
        required: ['percentage', 'priceIncrease']
      }
    },
    trailingStop: { type: 'number', minimum: 0.01, maximum: 0.5 },
    minSellValueBRL: { type: 'number', minimum: 10 }
  },
  required: ['levels', 'trailingStop', 'minSellValueBRL']
};

const saleStrategyConfigUpdateSchema = {
  type: 'object',
  properties: {
    levels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          percentage: { type: 'number', minimum: 0, maximum: 1 },
          priceIncrease: { type: 'number', minimum: 0 }
        },
        required: ['percentage', 'priceIncrease']
      }
    },
    trailingStop: { type: 'number', minimum: 0.01, maximum: 0.5 },
    minSellValueBRL: { type: 'number', minimum: 10 }
  }
};

const profitSummarySchema = {
  type: 'object',
  properties: {
    totalProfit: { type: 'number' },
    bySymbol: {
      type: 'object',
      additionalProperties: { type: 'number' }
    },
    totalProfitBRL: { type: 'string' },
    bySymbolBRL: {
      type: 'object',
      additionalProperties: { type: 'string' }
    },
    totalGain: { type: 'number' },
    totalLoss: { type: 'number' }
  }
};

const detailedStatusSchema = {
  type: 'object',
  properties: {
    symbols: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          buyThreshold: { type: 'number' },
          sellThreshold: { type: 'number' },
          checkInterval: { type: 'string' },
          sellStrategy: { 
            type: 'string', 
            enum: ['security', 'basic', 'aggressive'],
            default: 'security'
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          __v: { type: 'number' },
          lastExecution: { type: 'string', format: 'date-time' },
          nextExecution: { type: 'string', format: 'date-time' },
          readableInterval: { type: 'string' },
          status: { type: 'string', enum: ['ready', 'disabled'] }
        }
      }
    },
    summary: {
      type: 'object',
      properties: {
        totalSymbols: { type: 'number' },
        enabledSymbols: { type: 'number' },
        disabledSymbols: { type: 'number' },
        readySymbols: { type: 'number' },
        cooldownSymbols: { type: 'number' }
      }
    }
  }
};

const jobRoutes = async (fastify, opts) => {
  // Rotas do Job (Automação de ordens)

  // Lista todos os símbolos e se estão ativos
  fastify.get('/job/status', jobStatusHandler);

  // Atualiza a configuração de um símbolo ou global
  fastify.post('/job/config', jobConfigHandler);

  // Atualiza apenas o intervalo de execução (cron) dos jobs
  fastify.post('/job/interval', jobUpdateIntervalHandler);

  // Ativa/desativa um símbolo
  fastify.post('/job/toggle/:symbol', jobToggleHandler);

  // Executa o job para um símbolo específico (compra/venda automática)
  fastify.post('/job/run', jobRunHandler);

  // Remove um símbolo da automação
  fastify.delete('/job/symbols/:symbol', jobRemoveSymbolHandler);

  // Busca a configuração de um símbolo
  fastify.get('/job/symbols/:symbol', jobGetSymbolHandler);

  // Status detalhado de todos os símbolos e suas execuções
  fastify.get('/job/status/detailed', jobStatusDetailedHandler);

  // Resumo de lucro/prejuízo total e por símbolo
  fastify.get('/job/profit-summary', require('../controllers/jobController').getProfitSummaryHandler);

  // Lista todas as estratégias de venda disponíveis, com descrição e regras
  fastify.get('/job/strategies', require('../controllers/jobController').getAllStrategiesHandler);

  // Reseta o tracking de preços de um símbolo
  fastify.post('/job/reset-price-tracking/:symbol', resetPriceTrackingHandler);
};

module.exports = jobRoutes; 