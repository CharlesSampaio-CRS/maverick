require('dotenv').config();
const Fastify = require('fastify');
const fastifySwagger = require('@fastify/swagger');
const fastifySwaggerUi = require('@fastify/swagger-ui');
const { connectMongo } = require('./db/mongo');
const cron = require('node-cron');
const jobService = require('./services/jobService');
const { jobRunHandler } = require('./controllers/jobController');

// Importar rotas
const ordersRoutes = require('./routes/orders');
const balanceRoutes = require('./routes/balance');
const jobRoutes = require('./routes/job');
const tickerRoutes = require('./routes/ticker');

const fastify = Fastify({ 
  logger: {
    level: 'info',
    prettyPrint: false,
    serializers: {
      req: () => ({}),
      res: () => ({})
    },
    stream: {
      write: (message) => {
        const log = JSON.parse(message);
        // Filtra o log "Server listening at"
        if (log.msg && log.msg.includes('Server listening at')) {
          return; // Não exibe este log
        }
        // Exibe todos os outros logs
        console.log(log.msg || message);
      }
    }
  }, 
  disableRequestLogging: true 
});

// Swagger plugins
fastify.register(fastifySwagger, {
  swagger: {
    info: {
      title: 'NovaDAX Bot API',
      description: 'API para automação de ordens',
      version: '1.0.0'
    }
  }
});
fastify.register(fastifySwaggerUi, { routePrefix: '/docs' });

// Rotas
fastify.register(ordersRoutes);
fastify.register(balanceRoutes);
fastify.register(jobRoutes);
fastify.register(tickerRoutes);

// Função para rodar todos os jobs habilitados automaticamente
async function runAllEnabledJobs() {
  try {
    const config = await jobService.status();
    if (!config.enabled) return;
    for (const symbolConfig of config.symbols) {
      if (symbolConfig.enabled) {
        fastify.log.info(`[CRON] Job: ${symbolConfig.symbol}`);
        await jobRunHandler(
          { body: { symbol: symbolConfig.symbol } },
          {
            send: (msg) => fastify.log.info(`[CRON][${symbolConfig.symbol}] ${msg?.message || msg}`),
            status: () => ({ send: (msg) => fastify.log.warn(`[CRON][${symbolConfig.symbol}] ${msg?.message || msg}`) })
          }
        );
      }
    }
  } catch (err) {
    fastify.log.error(`[CRON][ERRO]: ${err.message}`);
  }
}

// Agendamento dinâmico conforme checkInterval da configuração
async function setupCronJob() {
  const config = await jobService.status();
  const interval = config.checkInterval || '*/3 * * * *';
  cron.schedule(interval, runAllEnabledJobs);

  // Extrai intervalo em minutos ou horas
  let intervalStr = interval;
  if (/^\*\/(\d+) \* \* \* \*$/.test(interval)) {
    const min = parseInt(interval.match(/^\*\/(\d+) \* \* \* \*$/)[1]);
    intervalStr = `${min} min`;
  } else if (/^0 \*\/(\d+) \* \* \*$/.test(interval)) {
    const hr = parseInt(interval.match(/^0 \*\/(\d+) \* \* \*$/)[1]);
    intervalStr = `${hr} h`;
  }

  for (const symbolConfig of config.symbols) {
    if (symbolConfig.enabled) {
      fastify.log.info(`[CRON] Symbol: ${symbolConfig.symbol} | Buy: ${symbolConfig.buyThreshold} | Sell: ${symbolConfig.sellThreshold} | Intervalo: ${intervalStr}`);
    }
  }
}

setupCronJob();

// Inicialização
const start = async () => {
  try {
    await connectMongo();
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
