const {
  jobStatusHandler,
  jobToggleHandler,
  jobRunHandler,
  jobConfigHandler,
  jobRemoveSymbolHandler,
  jobGetSymbolHandler,
  jobStatusDetailedHandler,
  jobUpdateIntervalHandler
} = require('../controllers/jobController');

const jobConfigSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    checkInterval: { type: 'string' },
    symbols: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          buyThreshold: { type: 'number' },
          sellThreshold: { type: 'number' },
          enabled: { type: 'boolean' }
        }
      }
    }
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
              buyThreshold: { type: 'number' },
              sellThreshold: { type: 'number' },
              enabled: { type: 'boolean' }
            }
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
            enabled: { type: 'boolean' }
          }
        }
      }
    }
  }, jobGetSymbolHandler);

  fastify.get('/job/status/detailed', {
    schema: { summary: 'Get detailed job status', response: { 200: jobConfigSchema } }
  }, jobStatusDetailedHandler);
};

module.exports = jobRoutes; 