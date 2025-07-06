const jobService = require('../services/jobService');

async function jobStatusHandler(request, reply) {
  const result = await jobService.status();
  return reply.send(result);
}
async function jobToggleHandler(request, reply) {
  const result = await jobService.toggle();
  return reply.send(result);
}
async function jobRunHandler(request, reply) {
  const result = await jobService.run();
  return reply.send(result);
}
async function jobConfigHandler(request, reply) {
  const result = await jobService.config(request.body);
  return reply.send(result);
}
async function jobAddSymbolHandler(request, reply) {
  const result = await jobService.addSymbol(request.body);
  return reply.send(result);
}
async function jobRemoveSymbolHandler(request, reply) {
  const { symbol } = request.params;
  const result = await jobService.removeSymbol(symbol);
  return reply.send(result);
}
async function jobUpdateSymbolHandler(request, reply) {
  const { symbol } = request.params;
  const result = await jobService.updateSymbol(symbol, request.body);
  return reply.send(result);
}
async function jobGetSymbolHandler(request, reply) {
  const { symbol } = request.params;
  const result = await jobService.getSymbol(symbol);
  return reply.send(result);
}
async function jobStatusDetailedHandler(request, reply) {
  const result = await jobService.statusDetailed();
  return reply.send(result);
}

module.exports = {
  jobStatusHandler,
  jobToggleHandler,
  jobRunHandler,
  jobConfigHandler,
  jobAddSymbolHandler,
  jobRemoveSymbolHandler,
  jobUpdateSymbolHandler,
  jobGetSymbolHandler,
  jobStatusDetailedHandler
}; 