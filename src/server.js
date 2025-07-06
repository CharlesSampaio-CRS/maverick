const Fastify = require('fastify');
const fastifySwagger = require('@fastify/swagger');
const fastifySwaggerUi = require('@fastify/swagger-ui');
const { connectMongo } = require('./db/mongo');

// Importar rotas
const ordersRoutes = require('./routes/orders');
const balanceRoutes = require('./routes/balance');
const jobRoutes = require('./routes/job');
const tickerRoutes = require('./routes/ticker');

const fastify = Fastify({ logger: true });

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

// Inicialização
const start = async () => {
  try {
    await connectMongo();
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info('Servidor rodando na porta 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
