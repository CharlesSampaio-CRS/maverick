require('newrelic');
require('dotenv').config();
const Fastify = require('fastify');
const fastifySwagger = require('@fastify/swagger');
const fastifySwaggerUi = require('@fastify/swagger-ui');
const fastifyCompress = require('@fastify/compress');
const fastifyRateLimit = require('@fastify/rate-limit');
const { connectMongo } = require('./db/mongo');
const cron = require('node-cron');
const jobService = require('./services/jobService');
const { jobRunHandler } = require('./controllers/jobController');

// Import routes
const ordersRoutes = require('./routes/orders');
const balanceRoutes = require('./routes/balance');
const jobRoutes = require('./routes/job');
const tickerRoutes = require('./routes/ticker');

// Global variable to store cron job references by symbol
let cronJobs = {};

const fastify = Fastify({ 
  logger: false,
  disableRequestLogging: true,
  // Performance optimizations
  trustProxy: true,
  connectionTimeout: 30000,
  keepAliveTimeout: 30000,
  maxRequestsPerSocket: 100
});

// Register compression plugin
fastify.register(fastifyCompress, {
  threshold: 1024, // Only compress responses larger than 1KB
  level: 6 // Compression level (0-9)
});

// Register rate limiting
fastify.register(fastifyRateLimit, {
  max: 100, // Maximum 100 requests per window
  timeWindow: '1 minute', // Time window
  allowList: ['127.0.0.1', 'localhost'], // Allow local requests
  errorResponseBuilder: function (request, context) {
    return {
      code: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${context.after}`,
      date: Date.now(),
      expiresIn: context.ttl
    }
  }
});

// Swagger plugins
fastify.register(fastifySwagger, {
  swagger: {
    info: {
      title: 'NovaDAX Bot API',
      description: 'API for order automation',
      version: '1.0.0'
    }
  }
});
fastify.register(fastifySwaggerUi, { routePrefix: '/docs' });

// Routes
fastify.register(ordersRoutes);
fastify.register(balanceRoutes);
fastify.register(jobRoutes);
fastify.register(tickerRoutes);

// Function to stop all cron jobs
function stopAllCronJobs() {
  for (const symbol in cronJobs) {
    if (cronJobs[symbol]) {
      cronJobs[symbol].stop();
      delete cronJobs[symbol];
      console.log(`[CRON] Stopped job for symbol: ${symbol}`);
    }
  }
}

// Function to create a cron job for a symbol
function createSymbolCronJob(symbolConfig) {
  const { symbol, checkInterval, enabled, sellStrategy } = symbolConfig;
  if (!enabled) return;
  if (!checkInterval) return;

  // Stop previous job for this symbol if exists
  if (cronJobs[symbol]) {
    cronJobs[symbol].stop();
    delete cronJobs[symbol];
    console.log(`[CRON] Stopping previous job for symbol: ${symbol} | Strategy: ${sellStrategy || 'security'}`);
  }

  // Create new job for this symbol
  cronJobs[symbol] = cron.schedule(checkInterval, async () => {
    console.log(`[CRON] Running job for symbol: ${symbol}`);
    await jobRunHandler(
      { body: { symbol } },
      {
        send: (msg) => {
          console.log(`[CRON][${symbol}] ${msg?.message || msg}`);
        },
        status: () => ({ send: (msg) => {
          console.log(`[CRON][${symbol}] ${msg?.message || msg}`);
        } })
      }
    );
  }, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
  });

  // Adiciona buyThreshold e sellThreshold ao log
  const buyThreshold = symbolConfig.buyThreshold !== undefined ? symbolConfig.buyThreshold : 'N/A';
  const sellThreshold = symbolConfig.sellThreshold !== undefined ? symbolConfig.sellThreshold : 'N/A';
  console.log(`[CRON] New job scheduled for symbol: ${symbol} with interval: ${checkInterval} | Strategy: ${sellStrategy || 'security'} | BuyThreshold: ${buyThreshold} | SellThreshold: ${sellThreshold}`);
}

// Function to setup all cron jobs according to each symbol's interval
async function setupAllSymbolCronJobs() {
  try {
    console.log('[CRON] Setting up cron jobs for all symbols...');
    stopAllCronJobs();
    const config = await jobService.status();
    if (config.symbols && config.symbols.length > 0) {
      for (const symbolConfig of config.symbols) {
        if (symbolConfig.enabled && symbolConfig.checkInterval) {
          createSymbolCronJob(symbolConfig);
        }
      }
    } else {
      console.log('[CRON] No symbols configured');
    }
  } catch (err) {
    console.error('[CRON] Error setting up symbol cron jobs:', err.message);
    throw err;
  }
}

// Function to update scheduling in real time
async function updateCronSchedule() {
  try {
    console.log('[CRON] Starting schedule update...');
    await setupAllSymbolCronJobs();
    // Após atualizar, mostrar os símbolos que tiveram agendamento atualizado
    const config = await jobService.status();
    const updatedSymbols = (config.symbols || []).filter(s => s.enabled && s.checkInterval).map(s => `${s.symbol} (${s.checkInterval})`).join(', ');
    if (updatedSymbols) {
      console.log(`[CRON] Schedule updated successfully for: ${updatedSymbols}`);
    } else {
      console.log('[CRON] Schedule updated, but no symbols enabled.');
    }
    return true;
  } catch (err) {
    console.error(`[CRON][ERROR] Failed to update schedule: ${err.message}`);
    return false;
  }
}

// Export function to be used by controllers
fastify.decorate('updateCronSchedule', updateCronSchedule);

// Initialization
const start = async () => {
  try {
    await connectMongo();
    // Setup cron jobs after MongoDB connection is established
    await setupAllSymbolCronJobs();
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
