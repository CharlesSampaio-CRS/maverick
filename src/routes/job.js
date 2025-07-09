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
  getMonitoringStatusHandler,
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
    monitoringEnabled: { type: 'boolean' },
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

  fastify.get('/job/profit-summary', {
    schema: {
      tags: ['Strategies'],
      summary: 'Get total profit/loss summary',
      response: { 200: profitSummarySchema }
    }
  }, require('../controllers/jobController').getProfitSummaryHandler);

  // Remove the /job/strategy-status endpoint
  // fastify.get('/job/strategy-status', { ... }, jobStrategyStatusHandler);

  // Add new endpoint for all strategies with description and rule
  fastify.get('/job/strategies', {
    schema: {
      tags: ['Strategies'],
      summary: 'Get all sale strategies with description and rule',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              rule: {
                type: 'object',
                properties: {
                  levels: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        percentage: { type: 'number' },
                        priceIncrease: { type: 'number' }
                      }
                    }
                  },
                  trailingStop: { type: 'number' },
                  minSellValueBRL: { type: 'number' }
                }
              }
            }
          }
        }
      }
    }
  }, require('../controllers/jobController').getAllStrategiesHandler);

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

  fastify.get('/job/price-stats/:symbol', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get price statistics for a symbol',
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
            symbol: { type: 'string' },
            currentPrice: { type: 'number' },
            highestPrice: { type: 'number' },
            lowestPrice: { type: 'number' },
            averagePrice: { type: 'number' },
            priceChange: { type: 'number' },
            priceChangePercent: { type: 'string' },
            lastUpdate: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  }, getPriceStatsHandler);

  fastify.post('/job/reset-price-tracking/:symbol', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Reset price tracking for a symbol',
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
            message: { type: 'string' }
          }
        }
      }
    }
  }, resetPriceTrackingHandler);
};

module.exports = jobRoutes; 