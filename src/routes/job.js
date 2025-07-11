const {
  jobStatusHandler,
  jobToggleHandler,
  jobRunHandler,
  jobConfigHandler,
  jobRemoveSymbolHandler,
  jobGetSymbolHandler,
  jobStatusDetailedHandler,
  jobUpdateIntervalHandler,
  resetPriceTrackingHandler
} = require('../controllers/jobController');

const jobConfigSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string', description: 'Símbolo da moeda (ex: BTC_BRL)' },
    buyThreshold: { type: 'number', description: 'Limite percentual para compra (ex: -8)' },
    sellThreshold: { type: 'number', description: 'Limite percentual para venda (ex: 5)' },
    enabled: { type: 'boolean', description: 'Se o símbolo está habilitado', default: true },
    checkInterval: { type: 'string', description: 'Intervalo de verificação em formato cron (ex: */10 * * * *)', default: '*/30 * * * *' },
    sellStrategy: { type: 'string', enum: ['security', 'basic', 'aggressive'], default: 'security', description: 'Estratégia de venda a ser utilizada' },
    minBuyPrice: { type: 'number', description: 'Preço mínimo para compra' },
    maxSellPrice: { type: 'number', description: 'Preço máximo para venda' },
    priceTrackingEnabled: { type: 'boolean', description: 'Se o tracking de preços está habilitado', default: true },
    minProfitPercent: { type: 'number', description: 'Lucro mínimo percentual', default: 2.0 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    __v: { type: 'number' }
  }
};

const symbolBodySchema = {
  type: 'object',
  required: ['symbol'],
  properties: {
    symbol: { type: 'string', description: 'Símbolo da moeda (ex: BTC_BRL)' }
  }
};

const symbolParamSchema = {
  type: 'object',
  required: ['symbol'],
  properties: {
    symbol: { type: 'string', description: 'Símbolo da moeda (ex: BTC_BRL)' }
  }
};

const intervalSchema = {
  type: 'object',
  required: ['checkInterval'],
  properties: {
    checkInterval: { 
      type: 'string', 
      description: 'Intervalo de verificação em formato cron',
      pattern: '^\\*/(\\d+) \\* \\* \\* \\*$|^0 \\*/(\\d+) \\* \\* \\*$|^0 0 \\* \\* \\*$|^0 \\* \\* \\* \\*$'
    }
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
    totalProfit: { type: 'string', description: 'Lucro total em BRL' },
    bySymbol: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Lucro por símbolo',
      example: { 'BTC_BRL': '100.50', 'ETH_BRL': '49.75' }
    },
    totalGain: { type: 'string', description: 'Ganho total' },
    totalLoss: { type: 'string', description: 'Perda total' },
    operationsCount: { type: 'number', description: 'Número total de operações' }
  }
};

const detailedStatusSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean', description: 'Se o sistema está habilitado' },
    cooldownMinutes: { type: 'number', description: 'Minutos de cooldown' },
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
            enum: ['security', 'basic', 'aggressive']
          },
          enabled: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
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

const strategySchema = {
  type: 'object',
  properties: {
    type: { type: 'string', description: 'Tipo da estratégia' },
    name: { type: 'string', description: 'Nome da estratégia' },
    description: { type: 'string', description: 'Descrição da estratégia' },
    rule: { type: 'object', description: 'Regras da estratégia' },
    ruleDescription: { type: 'string', description: 'Descrição das regras' }
  }
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Mensagem de erro' }
  }
};

const successResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Operação realizada com sucesso' }
  }
};

const jobRunResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Buy order executed' },
    op: { type: 'object', description: 'Detalhes da operação' },
    priceCheck: { type: 'object', description: 'Verificação de preço' }
  }
};

const jobRoutes = async (fastify, opts) => {
  // Rotas do Job (Automação de ordens)

  // Lista todos os símbolos e se estão ativos
  fastify.get('/job/status', {
    schema: {
      summary: 'Lista status de todos os símbolos',
      description: 'Retorna todos os símbolos configurados e se estão ativos.',
      tags: ['Job'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              status: { type: 'boolean' }
            }
          }
        },
        500: errorResponseSchema
      }
    }
  }, jobStatusHandler);

  // Atualiza a configuração de um símbolo ou global
  fastify.post('/job/config', {
    schema: {
      summary: 'Atualiza configuração de um símbolo ou global',
      description: 'Atualiza a configuração de um símbolo específico (requer o campo symbol) ou a configuração global.',
      tags: ['Job'],
      body: jobConfigSchema,
      response: {
        200: jobConfigSchema,
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, jobConfigHandler);

  // Atualiza apenas o intervalo de execução (cron) dos jobs
  fastify.post('/job/interval', {
    schema: {
      summary: 'Atualiza o intervalo global de execução dos jobs',
      description: 'Atualiza o intervalo (cron) global de execução dos jobs.',
      tags: ['Job'],
      body: intervalSchema,
      response: {
        200: jobConfigSchema,
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, jobUpdateIntervalHandler);

  // Ativa/desativa um símbolo
  fastify.post('/job/toggle/:symbol', {
    schema: {
      summary: 'Ativa ou desativa um símbolo',
      description: 'Alterna o status (ativo/inativo) de um símbolo específico.',
      tags: ['Job'],
      params: symbolParamSchema,
      response: {
        200: jobConfigSchema,
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, jobToggleHandler);

  // Executa o job para um símbolo específico (compra/venda automática)
  fastify.post('/job/run', {
    schema: {
      summary: 'Executa o job para um símbolo',
      description: 'Executa a automação de compra/venda para o símbolo informado.',
      tags: ['Job'],
      body: symbolBodySchema,
      response: {
        200: jobRunResponseSchema,
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, jobRunHandler);

  // Remove um símbolo da automação
  fastify.delete('/job/symbols/:symbol', {
    schema: {
      summary: 'Remove um símbolo',
      description: 'Remove um símbolo da automação.',
      tags: ['Job'],
      params: symbolParamSchema,
      response: {
        200: jobConfigSchema,
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, jobRemoveSymbolHandler);

  // Busca a configuração de um símbolo
  fastify.get('/job/symbols/:symbol', {
    schema: {
      summary: 'Busca configuração de um símbolo',
      description: 'Retorna a configuração de um símbolo específico.',
      tags: ['Job'],
      params: symbolParamSchema,
      response: {
        200: jobConfigSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, jobGetSymbolHandler);

  // Status detalhado de todos os símbolos e suas execuções
  fastify.get('/job/status/detailed', {
    schema: {
      summary: 'Status detalhado de todos os símbolos',
      description: 'Retorna status detalhado de todos os símbolos e execuções.',
      tags: ['Job'],
      response: {
        200: detailedStatusSchema,
        500: errorResponseSchema
      }
    }
  }, jobStatusDetailedHandler);

  // Resumo de lucro/prejuízo total e por símbolo
  fastify.get('/job/profit-summary', {
    schema: {
      summary: 'Resumo de lucro/prejuízo',
      description: 'Retorna o resumo de lucro/prejuízo total e por símbolo.',
      tags: ['Job'],
      response: {
        200: profitSummarySchema,
        500: errorResponseSchema
      }
    }
  }, require('../controllers/jobController').getProfitSummaryHandler);

  // Lista todas as estratégias de venda disponíveis, com descrição e regras
  fastify.get('/job/strategies', {
    schema: {
      summary: 'Lista estratégias de venda',
      description: 'Retorna todas as estratégias de venda disponíveis, com descrição e regras.',
      tags: ['Job'],
      response: {
        200: {
          type: 'array',
          items: strategySchema
        },
        500: errorResponseSchema
      }
    }
  }, require('../controllers/jobController').getAllStrategiesHandler);

  // Reseta o tracking de preços de um símbolo
  fastify.post('/job/reset-price-tracking/:symbol', {
    schema: {
      summary: 'Reseta o tracking de preços de um símbolo',
      description: 'Reseta o tracking de preços para o símbolo informado.',
      tags: ['Job'],
      params: symbolParamSchema,
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, resetPriceTrackingHandler);
};

module.exports = jobRoutes; 