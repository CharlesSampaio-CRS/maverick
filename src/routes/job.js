const jobRoutes = async (fastify, opts) => {
  fastify.get('/job/status', {
    schema: { summary: 'Obter status do job', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobStatusHandler(request, reply));

  fastify.post('/job/toggle', {
    schema: { summary: 'Habilitar/desabilitar job', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobToggleHandler(request, reply));

  fastify.post('/job/run', {
    schema: { summary: 'Executar job manualmente', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobRunHandler(request, reply));

  fastify.post('/job/config', {
    schema: { summary: 'Atualizar configuração do job', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobConfigHandler(request, reply));

  fastify.post('/job/symbols', {
    schema: { summary: 'Adicionar símbolo', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobAddSymbolHandler(request, reply));

  fastify.delete('/job/symbols/:symbol', {
    schema: { summary: 'Remover símbolo', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobRemoveSymbolHandler(request, reply));

  fastify.put('/job/symbols/:symbol', {
    schema: { summary: 'Atualizar símbolo', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobUpdateSymbolHandler(request, reply));

  fastify.get('/job/symbols/:symbol', {
    schema: { summary: 'Obter configuração de símbolo', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobGetSymbolHandler(request, reply));

  fastify.get('/job/status/detailed', {
    schema: { summary: 'Obter status detalhado do job', response: { 200: { type: 'object' } } }
  }, async (request, reply) => fastify.jobStatusDetailedHandler(request, reply));
};

module.exports = jobRoutes; 