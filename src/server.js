require('dotenv').config();
const Fastify = require('fastify');
const fastifySwagger = require('@fastify/swagger');
const fastifySwaggerUi = require('@fastify/swagger-ui');
const { connectMongo } = require('./db/mongo');
const cron = require('node-cron');
const jobService = require('./services/jobService');
const { jobRunHandler } = require('./controllers/jobController');

// Import routes
const ordersRoutes = require('./routes/orders');
const balanceRoutes = require('./routes/balance');
const jobRoutes = require('./routes/job');
const tickerRoutes = require('./routes/ticker');

// Global variable to store cron job reference
let cronJob = null;

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
        // Filter "Server listening at" log
        if (log.msg && log.msg.includes('Server listening at')) {
          return; // Don't display this log
        }
        // Display all other logs
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

// Function to run all enabled jobs automatically
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
    fastify.log.error(`[CRON][ERROR]: ${err.message}`);
  }
}

// Function to stop current cron job
function stopCronJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    fastify.log.info('[CRON] Scheduled job stopped');
  }
}

// Function to create a new cron job
function createCronJob(interval) {
  // Stop previous job if exists
  if (cronJob) {
    fastify.log.info('[CRON] Stopping previous job...');
    cronJob.stop();
    cronJob = null;
  }
  
  // Create new job
  cronJob = cron.schedule(interval, runAllEnabledJobs, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
  });
  
  fastify.log.info(`[CRON] New job scheduled with interval: ${interval}`);
  return cronJob;
}

// Function to validate cron format
function validateCronFormat(expression) {
  // Check if cron.validate is available
  if (typeof cron.validate === 'function') {
    return cron.validate(expression);
  }
  
  // Basic manual validation
  const cronRegex = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;
  return cronRegex.test(expression);
}

// Dynamic scheduling according to checkInterval configuration
async function setupCronJob() {
  try {
    console.log('[CRON] Setting up cron job...');
    const config = await jobService.status();
    console.log('[CRON] Job config loaded:', { enabled: config.enabled, symbolsCount: config.symbols.length });
    
    const interval = config.checkInterval || '*/3 * * * *';
    createCronJob(interval);

    // Extract interval in minutes or hours
    let intervalStr = interval;
    if (/^\*\/(\d+) \* \* \* \*$/.test(interval)) {
      const min = parseInt(interval.match(/^\*\/(\d+) \* \* \* \*$/)[1]);
      intervalStr = `${min} min`;
    } else if (/^0 \*\/(\d+) \* \* \*$/.test(interval)) {
      const hr = parseInt(interval.match(/^0 \*\/(\d+) \* \* \*$/)[1]);
      intervalStr = `${hr} h`;
    }

    console.log(`[CRON] Job interval: ${intervalStr}`);
    
    if (config.symbols && config.symbols.length > 0) {
      for (const symbolConfig of config.symbols) {
        if (symbolConfig.enabled) {
          console.log(`[CRON] Symbol: ${symbolConfig.symbol} | Buy: ${symbolConfig.buyThreshold} | Sell: ${symbolConfig.sellThreshold} | Interval: ${intervalStr}`);
        }
      }
    } else {
      console.log('[CRON] No symbols configured');
    }
  } catch (err) {
    console.error('[CRON] Error setting up cron job:', err.message);
    throw err;
  }
}

// Function to update scheduling in real time
async function updateCronSchedule() {
  try {
    fastify.log.info('[CRON] Starting schedule update...');
    
    const config = await jobService.status();
    const interval = config.checkInterval || '*/3 * * * *';
    
    // Validate cron format
    if (!validateCronFormat(interval)) {
      throw new Error(`Invalid interval format: ${interval}`);
    }
    
    fastify.log.info(`[CRON] Applying new interval: ${interval}`);
    createCronJob(interval);
    
    // Extract interval in minutes or hours for log
    let intervalStr = interval;
    if (/^\*\/(\d+) \* \* \* \*$/.test(interval)) {
      const min = parseInt(interval.match(/^\*\/(\d+) \* \* \* \*$/)[1]);
      intervalStr = `${min} min`;
    } else if (/^0 \*\/(\d+) \* \* \*$/.test(interval)) {
      const hr = parseInt(interval.match(/^0 \*\/(\d+) \* \* \*$/)[1]);
      intervalStr = `${hr} h`;
    }
    
    fastify.log.info(`[CRON] Schedule updated successfully to: ${intervalStr}`);
    return true;
  } catch (err) {
    fastify.log.error(`[CRON][ERROR] Failed to update schedule: ${err.message}`);
    return false;
  }
}

// Export function to be used by controllers
fastify.decorate('updateCronSchedule', updateCronSchedule);

// Initialization
const start = async () => {
  try {
    await connectMongo();
    
    // Setup cron job after MongoDB connection is established
    await setupCronJob();
    
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
