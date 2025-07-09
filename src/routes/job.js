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
  getMonitoringStatusHandler
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
    monitoringEnabled: { type: 'boolean' },
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
      tags: ['Trading Bot'],
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
    schema: { 
      tags: ['Trading Bot'],
      summary: 'Update job configuration', 
      body: jobConfigSchema, 
      response: { 200: jobConfigSchema } 
    }
  }, jobConfigHandler);

  fastify.post('/job/interval', {
    schema: { 
      tags: ['Trading Bot'],
      summary: 'Update only job interval', 
      body: intervalSchema, 
      response: { 200: jobConfigSchema } 
    }
  }, jobUpdateIntervalHandler);

  fastify.post('/job/toggle/:symbol', {
    schema: {
      tags: ['Trading Bot'],
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
      tags: ['Trading Bot'],
      summary: 'Run job for a symbol',
      body: symbolBodySchema,
      response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } }
    }
  }, jobRunHandler);

  fastify.delete('/job/symbols/:symbol', {
    schema: { 
      tags: ['Trading Bot'],
      summary: 'Remove symbol', 
      response: { 200: jobConfigSchema } 
    }
  }, jobRemoveSymbolHandler);

  fastify.get('/job/symbols/:symbol', {
    schema: {
      tags: ['Trading Bot'],
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
    schema: { 
      tags: ['Trading Bot'],
      summary: 'Get detailed job status', 
      response: { 200: detailedStatusSchema } 
    }
  }, jobStatusDetailedHandler);

  // Rotas para configuração da estratégia de venda
  fastify.get('/job/sale-strategy', {
    schema: {
      tags: ['Strategies'],
      summary: 'Get sale strategy configuration',
      response: { 200: saleStrategyConfigSchema }
    }
  }, require('../controllers/jobController').getSaleStrategyConfigHandler);

  fastify.put('/job/sale-strategy', {
    schema: {
      tags: ['Strategies'],
      summary: 'Update sale strategy configuration',
      body: saleStrategyConfigUpdateSchema,
      response: { 200: saleStrategyConfigSchema }
    }
  }, require('../controllers/jobController').updateSaleStrategyConfigHandler);

  fastify.get('/job/profit-summary', {
    schema: {
      tags: ['Strategies'],
      summary: 'Get total profit/loss summary',
      response: { 200: profitSummarySchema }
    }
  }, require('../controllers/jobController').getProfitSummaryHandler);

  fastify.get('/job/strategy-status', {
    schema: {
      tags: ['Strategies'],
      summary: 'Get status of active sale strategies',
      response: {
        200: {
          type: 'object',
          properties: {
            activeStrategies: { type: 'number' },
            strategies: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  symbol: { type: 'string' },
                  strategy: { type: 'string' },
                  strategyName: { type: 'string' },
                  initialAmount: { type: 'number' },
                  remainingAmount: { type: 'number' },
                  firstSellPrice: { type: 'number' },
                  currentHighestPrice: { type: 'number' },
                  trailingStop: { type: 'number' },
                  profitMetrics: {
                    type: 'object',
                    properties: {
                      avgSellPrice: { type: 'number' },
                      profitPercent: { type: 'string' },
                      highestPrice: { type: 'number' },
                      maxProfitPercent: { type: 'string' }
                    }
                  },
                  remainingTargets: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        percentage: { type: 'number' },
                        price: { type: 'number' },
                        priceIncrease: { type: 'string' }
                      }
                    }
                  },
                  lastUpdate: { type: 'string', format: 'date-time' },
                  age: { type: 'string' }
                }
              }
            },
            summary: {
              type: 'object',
              properties: {
                totalActive: { type: 'number' },
                avgProfitPotential: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, jobStrategyStatusHandler);

  // Monitoring endpoints
  fastify.get('/job/monitoring-status', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get monitoring status for all symbols',
      response: { 
        200: {
          type: 'object',
          properties: {
            activeBuyMonitoring: { type: 'number' },
            activeSellMonitoring: { type: 'number' },
            buyMonitoring: { type: 'array' },
            sellMonitoring: { type: 'array' },
            defaultMonitoringConfig: { type: 'object' },
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
};

module.exports = jobRoutes; 