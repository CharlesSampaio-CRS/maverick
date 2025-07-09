const {
  jobStatusHandler,
  jobToggleHandler,
  jobRunHandler,
  jobConfigHandler,
  jobRemoveSymbolHandler,
  jobGetSymbolHandler,
  jobStatusDetailedHandler,
  jobUpdateIntervalHandler,
  getMonitoringStatusHandler,
  updateBuyMonitoringConfigHandler,
  updateSellMonitoringConfigHandler
} = require('../controllers/jobController');

const jobConfigSchema = {
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
  fastify.get('/job/status', {
    schema: {
      summary: 'Get job list',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              status: { type: 'boolean' }
            },
            required: ['symbol', 'status']
          }
        }
      }
    }
  }, jobStatusHandler);

  fastify.post('/job/config', {
    schema: { summary: 'Update job configuration', body: jobConfigSchema, response: { 200: jobConfigSchema } }
  }, jobConfigHandler);

  fastify.post('/job/interval', {
    schema: { 
      summary: 'Update only job interval', 
      body: intervalSchema, 
      response: { 200: jobConfigSchema } 
    }
  }, jobUpdateIntervalHandler);

  fastify.post('/job/toggle/:symbol', {
    schema: {
      summary: 'Toggle symbol enabled status',
      params: {
        type: 'object',
        properties: { symbol: { type: 'string' } }
      },
      response: { 200: jobConfigSchema }
    }
  }, jobToggleHandler);

  fastify.post('/job/run', {
    schema: {
      summary: 'Run job for a symbol',
      body: symbolBodySchema,
      response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } }
    }
  }, jobRunHandler);

  fastify.delete('/job/symbols/:symbol', {
    schema: { summary: 'Remove symbol', response: { 200: jobConfigSchema } }
  }, jobRemoveSymbolHandler);

  fastify.get('/job/symbols/:symbol', {
    schema: {
      summary: 'Get symbol configuration',
      response: {
        200: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            buyThreshold: { type: 'number' },
            sellThreshold: { type: 'number' },
            checkInterval: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            __v: { type: 'number' }
          }
        }
      }
    }
  }, jobGetSymbolHandler);

  fastify.get('/job/status/detailed', {
    schema: { summary: 'Get detailed job status', response: { 200: detailedStatusSchema } }
  }, jobStatusDetailedHandler);

  // Rotas para configuração da estratégia de venda
  fastify.get('/job/sale-strategy', {
    schema: {
      summary: 'Obter configuração da estratégia de venda',
      response: { 200: saleStrategyConfigSchema }
    }
  }, require('../controllers/jobController').getSaleStrategyConfigHandler);

  fastify.put('/job/sale-strategy', {
    schema: {
      summary: 'Alterar configuração da estratégia de venda',
      body: saleStrategyConfigUpdateSchema,
      response: { 200: saleStrategyConfigSchema }
    }
  }, require('../controllers/jobController').updateSaleStrategyConfigHandler);

  fastify.get('/job/profit-summary', {
    schema: {
      summary: 'Get total profit/loss summary',
      response: { 200: profitSummarySchema }
    }
  }, require('../controllers/jobController').getProfitSummaryHandler);

  // Monitoring endpoints
  fastify.get('/job/monitoring-status', {
    schema: {
      summary: 'Get monitoring status for all symbols',
      response: { 
        200: {
          type: 'object',
          properties: {
            activeBuyMonitoring: { type: 'number' },
            activeSellMonitoring: { type: 'number' },
            buyMonitoring: { type: 'array' },
            sellMonitoring: { type: 'array' },
            buyMonitoringConfig: { 
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                monitorMinutes: { type: 'number' },
                buyOnRisePercent: { type: 'number' }
              }
            },
            sellStrategiesMonitoring: { type: 'object' },
            summary: { 
              type: 'object',
              properties: {
                totalActive: { type: 'number' },
                avgBuyTimeElapsed: { type: 'string' },
                avgSellTimeElapsed: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, getMonitoringStatusHandler);

  fastify.post('/job/buy-monitoring-config', {
    schema: {
      summary: 'Update buy monitoring configuration',
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          monitorMinutes: { type: 'number', minimum: 5, maximum: 1440 },
          buyOnRisePercent: { type: 'number', minimum: 0.1, maximum: 20 }
        }
      },
      response: { 200: { type: 'object' } }
    }
  }, updateBuyMonitoringConfigHandler);

  fastify.post('/job/sell-monitoring-config', {
    schema: {
      summary: 'Update sell monitoring configuration for a strategy',
      body: {
        type: 'object',
        properties: {
          strategyType: { type: 'string', enum: ['security', 'basic', 'aggressive'] },
          enabled: { type: 'boolean' },
          monitorMinutes: { type: 'number', minimum: 5, maximum: 1440 },
          sellOnDropPercent: { type: 'number', minimum: 0.1, maximum: 20 }
        },
        required: ['strategyType']
      },
      response: { 200: { type: 'object' } }
    }
  }, updateSellMonitoringConfigHandler);
};

module.exports = jobRoutes; 