const jobController = require('../controllers/jobController');
const jobService = require('../services/jobService');
const tickerService = require('../services/tickerService');
const balanceService = require('../services/balanceService');
const ordersService = require('../services/ordersService');
const priceTrackingService = require('../services/priceTrackingService');
const { JobConfig } = require('../models/JobConfig');
const sellStrategies = require('../utils/sellStrategies');
const Operation = require('../models/Operation');

// Mock de todas as dependências
jest.mock('../services/jobService');
jest.mock('../services/tickerService');
jest.mock('../services/balanceService');
jest.mock('../services/ordersService');
jest.mock('../services/priceTrackingService');
jest.mock('../models/JobConfig');
jest.mock('newrelic', () => ({
  recordCustomEvent: jest.fn(),
  recordMetric: jest.fn(),
  noticeError: jest.fn()
}));

jest.spyOn(Operation, 'find').mockReturnValue({
  exec: jest.fn().mockResolvedValue([
    { symbol: 'TEST_BRL', profit: 50 },
    { symbol: 'TEST_BRL', profit: 30 },
    { symbol: 'OTHER_BRL', profit: 20 }
  ])
});

describe('JobController', () => {
  let mockReply;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock padrão para reply
    mockReply = {
      send: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    // Limpar estado dos trackers (se existir)
    if (jobController.partialSales) {
      jobController.partialSales.clear();
    }

    // Mock padrão para serviços
    jobService.status.mockResolvedValue({
      enabled: true,
      symbols: []
    });
    
    tickerService.getTicker.mockResolvedValue({
      success: true,
      lastPrice: '100',
      changePercent24h: '5'
    });

    balanceService.getBalance.mockResolvedValue({
      available: '1000'
    });

    ordersService.createBuyOrder.mockResolvedValue({
      status: 'success',
      _id: 'test-id',
      amount: 100,
      price: 100
    });

    ordersService.createSellOrder.mockResolvedValue({
      status: 'success',
      _id: 'test-id',
      amount: 10,
      price: 100
    });

    priceTrackingService.shouldBuyAtPrice.mockResolvedValue({
      shouldBuy: true,
      reason: 'Price check passed'
    });

    priceTrackingService.shouldSellAtPrice.mockResolvedValue({
      shouldSell: true,
      reason: 'Price check passed'
    });

    priceTrackingService.updatePriceTracking.mockResolvedValue({
      success: true
    });

    JobConfig.updateOne.mockResolvedValue({});
  });

  describe('jobRunHandler', () => {
    describe('Validações básicas', () => {
      it('deve retornar erro quando symbol não é fornecido', async () => {
        await jobController.jobRunHandler({ body: {} }, mockReply);
        
        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'Symbol not provided'
        });
      });

      it('deve retornar erro quando symbol está desabilitado', async () => {
        jobService.status.mockResolvedValue({
          enabled: true,
          symbols: [{ symbol: 'TEST_BRL', enabled: false }]
        });

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith({
          success: false,
          message: 'Symbol is disabled'
        });
      });

      it('deve retornar erro quando ticker falha', async () => {
        tickerService.getTicker.mockResolvedValue({
          success: false,
          error: 'API error'
        });

        jobService.status.mockResolvedValue({
          enabled: true,
          symbols: [{ symbol: 'TEST_BRL', enabled: true }]
        });

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith({
          success: false,
          message: 'Error getting ticker data'
        });
      });
    });

    describe('Regras de compra', () => {
      it('deve executar compra quando changePercent24h <= buyThreshold', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: -10, // Deve ser negativo para permitir compra
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '-15' // -15 <= -10
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(ordersService.createBuyOrder).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          message: 'Buy order executed'
        }));
      });

      it('não deve executar compra quando changePercent24h > buyThreshold', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: 10 // Deve ser positivo para não ativar venda
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '-5' // -5 > -10 (não compra), mas -5 < 10 (não vende)
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(ordersService.createBuyOrder).not.toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: expect.stringContaining('No buy or sell condition met')
        }));
      });

      it('não deve permitir compra quando sellThreshold não é negativo', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: 5, // positivo - deve impedir compra
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '-15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: expect.stringContaining('Buy not allowed: sellThreshold must be negative')
        }));
      });

      it('não deve permitir compra quando preço atual >= limite baseado em lastSellPrice', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: -10,
            lastSellPrice: 100,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '91', // 100 + (-10%) = 90, então 91 >= 90
          changePercent24h: '-15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: expect.stringContaining('Buy skipped: current price')
        }));
      });

      it('deve permitir compra quando preço atual < limite baseado em lastSellPrice', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: -10,
            lastSellPrice: 100,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '89', // 100 + (-10%) = 90, então 89 < 90
          changePercent24h: '-15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(ordersService.createBuyOrder).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          message: 'Buy order executed'
        }));
      });

      it('não deve executar compra quando saldo BRL < 25', async () => {
        balanceService.getBalance.mockResolvedValue({
          available: '20'
        });

        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: -10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '-15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: 'No buy or sell condition met. Price is outside buy/sell thresholds.'
        }));
      });

      it('não deve executar compra quando price tracking falha', async () => {
        priceTrackingService.shouldBuyAtPrice.mockResolvedValue({
          shouldBuy: false,
          reason: 'Price too high'
        });

        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: -10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '-15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: 'Buy skipped: Price too high'
        }));
      });
    });

    describe('Regras de venda', () => {
      it('deve executar venda quando changePercent24h >= sellThreshold', async () => {
        // Limpar estado para garantir que não há tracker existente
        if (global.partialSales) {
          global.partialSales.clear();
        }

        // Configurar saldo suficiente para venda
        balanceService.getBalance.mockResolvedValue({
          available: '1000'
        });

        const config = {
          enabled: true,
          symbols: [{
            symbol: 'SELL_TEST_BRL', // Usar símbolo diferente
            enabled: true,
            buyThreshold: 10, // Deve ser positivo para permitir venda
            sellThreshold: 10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '15' // 15 >= 10
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'SELL_TEST_BRL' } }, mockReply);
        
        expect(ordersService.createSellOrder).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          message: expect.stringContaining('Sell order')
        }));
      });

      it('não deve executar venda quando changePercent24h < sellThreshold', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: 10
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '5' // 5 < 10
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(ordersService.createSellOrder).not.toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: expect.stringContaining('No buy or sell condition met')
        }));
      });

      it('não deve permitir venda quando buyThreshold não é positivo', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -5, // negativo
            sellThreshold: 10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: expect.stringContaining('Sell not allowed: buyThreshold must be positive')
        }));
      });

      it('não deve permitir venda quando preço atual <= limite baseado em lastBuyPrice', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: 10,
            sellThreshold: 10,
            lastBuyPrice: 100,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '109', // 100 + 10% = 110, então 109 <= 110
          changePercent24h: '15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: expect.stringContaining('Sell skipped: current price')
        }));
      });

      it('deve permitir venda quando preço atual > limite baseado em lastBuyPrice', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: 10,
            sellThreshold: 10,
            lastBuyPrice: 100,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '120', // 100 + 10% = 110, então 120 > 110
          changePercent24h: '15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(ordersService.createSellOrder).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          message: expect.stringContaining('Sell order')
        }));
      });

      it('não deve executar venda quando saldo da moeda base <= 0', async () => {
        balanceService.getBalance.mockResolvedValue({
          available: '0'
        });

        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: 10,
            sellThreshold: 10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: 'No buy or sell condition met. Price is outside buy/sell thresholds.'
        }));
      });

      it('não deve executar venda quando price tracking falha', async () => {
        // Limpar estado para garantir que não há tracker existente
        if (global.partialSales) {
          global.partialSales.clear();
        }

        // Configurar saldo suficiente para venda
        balanceService.getBalance.mockResolvedValue({
          available: '1000'
        });

        priceTrackingService.shouldSellAtPrice.mockResolvedValue({
          shouldSell: false,
          reason: 'Price too low'
        });

        const config = {
          enabled: true,
          symbols: [{
            symbol: 'SELL_FAIL_TEST_BRL', // Usar símbolo diferente
            enabled: true,
            buyThreshold: 10,
            sellThreshold: 10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'SELL_FAIL_TEST_BRL' } }, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: 'Sell skipped: Price too low'
        }));
      });
    });

    describe('Estratégias de venda', () => {
      it('deve executar primeira venda com estratégia security', async () => {
        const config = {
          enabled: true,
          symbols: [{
            symbol: 'FIRST_SELL_TEST_BRL', // Usar símbolo diferente
            enabled: true,
            buyThreshold: 10,
            sellThreshold: 10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'FIRST_SELL_TEST_BRL' } }, mockReply);
        
        expect(ordersService.createSellOrder).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          message: expect.stringContaining('Sell order (30%) executed')
        }));
      });

      it('deve executar venda subsequente quando condições são atendidas', async () => {
        const jobController = require('../controllers/jobController');
        // Simular que já existe um tracker para o símbolo
        const mockTracker = {
          updateHighestPrice: jest.fn(),
          shouldSell: jest.fn().mockReturnValue({
            shouldSell: true,
            amount: 100, // menor que remainingAmount
            reason: 'Price target reached',
            level: { percentage: 0.1, price: 110, executed: false }
          }),
          markLevelExecuted: jest.fn(),
          isComplete: jest.fn().mockReturnValue(false),
          sellLevels: [],
          firstSellPrice: 100,
          highestPrice: 110,
          trailingStop: 100, // menor que currentPrice para não acionar trailing stop
          remainingAmount: 1000 // maior que amount
        };

        // Inserir o tracker mockado diretamente no partialSales do controller
        jobController.partialSales.set('TEST_BRL', mockTracker);

        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: 10,
            sellThreshold: 10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '110',
          changePercent24h: '15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(ordersService.createSellOrder).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          message: expect.stringContaining('Sell order executed: Price target reached')
        }));

        // Limpar o tracker após o teste
        jobController.partialSales.delete('TEST_BRL');
      });
    });

    describe('Tratamento de erros', () => {
      it('deve capturar e retornar erro quando jobService.status falha', async () => {
        jobService.status.mockRejectedValue(new Error('Database error'));

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'Database error'
        });
      });

      it('deve capturar e retornar erro quando tickerService.getTicker falha', async () => {
        tickerService.getTicker.mockRejectedValue(new Error('API error'));

        jobService.status.mockResolvedValue({
          enabled: true,
          symbols: [{ symbol: 'TEST_BRL', enabled: true }]
        });

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'API error'
        });
      });

      it('deve capturar e retornar erro quando ordersService.createBuyOrder falha', async () => {
        ordersService.createBuyOrder.mockRejectedValue(new Error('Order creation failed'));

        const config = {
          enabled: true,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: -10,
            sellStrategy: 'security'
          }]
        };

        const ticker = {
          success: true,
          lastPrice: '100',
          changePercent24h: '-15'
        };

        jobService.status.mockResolvedValue(config);
        tickerService.getTicker.mockResolvedValue(ticker);

        await jobController.jobRunHandler({ body: { symbol: 'TEST_BRL' } }, mockReply);
        
        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'Order creation failed'
        });
      });
    });
  });

  describe('Handlers de configuração', () => {
    describe('jobConfigHandler', () => {
      it('deve atualizar configuração de símbolo específico', async () => {
        const mockServer = {
          updateCronSchedule: jest.fn()
        };

        const request = {
          body: {
            symbol: 'TEST_BRL',
            buyThreshold: -5,
            sellThreshold: 5
          },
          server: mockServer
        };

        jobService.updateConfig.mockResolvedValue({
          symbols: [{
            symbol: 'TEST_BRL',
            buyThreshold: -5,
            sellThreshold: 5,
            enabled: true
          }]
        });

        await jobController.jobConfigHandler(request, mockReply);
        
        expect(jobService.updateConfig).toHaveBeenCalledWith(request.body);
        expect(mockServer.updateCronSchedule).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          symbol: 'TEST_BRL',
          buyThreshold: -5,
          sellThreshold: 5
        }));
      });

      it('deve atualizar configuração global', async () => {
        const mockServer = {
          updateCronSchedule: jest.fn()
        };

        const request = {
          body: {
            enabled: false,
            cooldownMinutes: 60
          },
          server: mockServer
        };

        jobService.updateConfig.mockResolvedValue({
          enabled: false,
          cooldownMinutes: 60,
          symbols: []
        });

        await jobController.jobConfigHandler(request, mockReply);
        
        expect(jobService.updateConfig).toHaveBeenCalledWith(request.body);
        expect(mockServer.updateCronSchedule).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          enabled: false,
          cooldownMinutes: 60
        }));
      });

      it('deve retornar erro quando símbolo não é encontrado após atualização', async () => {
        const mockServer = {
          updateCronSchedule: jest.fn()
        };

        const request = {
          body: {
            symbol: 'TEST_BRL',
            buyThreshold: -5
          },
          server: mockServer
        };

        jobService.updateConfig.mockResolvedValue({
          symbols: [] // Símbolo não encontrado
        });

        await jobController.jobConfigHandler(request, mockReply);
        
        expect(mockReply.status).toHaveBeenCalledWith(404);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'Symbol configuration not found after update'
        });
      });

      it('deve capturar e retornar erro quando updateConfig falha', async () => {
        const request = {
          body: { symbol: 'TEST_BRL' },
          server: {}
        };

        jobService.updateConfig.mockRejectedValue(new Error('Update failed'));

        await jobController.jobConfigHandler(request, mockReply);
        
        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'Update failed'
        });
      });
    });

    describe('jobStatusDetailedHandler', () => {
      it('deve retornar status detalhado com informações enriquecidas', async () => {
        const config = {
          enabled: true,
          cooldownMinutes: 30,
          symbols: [{
            symbol: 'TEST_BRL',
            enabled: true,
            buyThreshold: -10,
            sellThreshold: 10,
            checkInterval: '*/5 * * * *',
            sellStrategy: 'security'
          }]
        };

        jobService.status.mockResolvedValue(config);

        await jobController.jobStatusDetailedHandler({}, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          enabled: true,
          cooldownMinutes: 30,
          symbols: expect.arrayContaining([
            expect.objectContaining({
              symbol: 'TEST_BRL',
              enabled: true,
              status: 'ready',
              strategyInfo: expect.objectContaining({
                type: 'security',
                name: expect.any(String)
              })
            })
          ])
        }));
      });

      it('deve capturar e retornar erro quando status falha', async () => {
        jobService.status.mockRejectedValue(new Error('Status failed'));

        await jobController.jobStatusDetailedHandler({}, mockReply);
        
        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'Status failed'
        });
      });
    });

    describe('jobStrategyStatusHandler', () => {
      it('deve retornar status das estratégias ativas', async () => {
        const jobController = require('../controllers/jobController');
        // Adicionar tracker mockado
        const mockTracker = {
          getProfitMetrics: jest.fn().mockReturnValue({
            avgSellPrice: 110,
            profitPercent: '0.00',
            highestPrice: 110,
            maxProfitPercent: '0.00'
          }),
          sellLevels: [],
          initialAmount: 1000,
          remainingAmount: 500,
          firstSellPrice: 110,
          highestPrice: 110,
          trailingStop: 100,
          lastUpdate: Date.now()
        };
        jobController.partialSales.set('TEST_BRL', mockTracker);

        await jobController.jobStrategyStatusHandler({}, mockReply);
        
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          activeStrategies: expect.any(Number),
          strategies: expect.arrayContaining([
            expect.objectContaining({
              strategy: 'security'
            })
          ])
        }));

        // Limpar após o teste
        jobController.partialSales.delete('TEST_BRL');
      });
    });

    describe('getProfitSummaryHandler', () => {
      it('deve retornar resumo de lucros das operações', async () => {
        await jobController.getProfitSummaryHandler({}, mockReply);
        
        expect(mockReply.send).toHaveBeenCalled();
      }, 15000); // Aumentar timeout
    });
  });

  describe('Handlers de símbolos', () => {
    describe('jobAddSymbolHandler', () => {
      it('deve adicionar novo símbolo', async () => {
        const request = {
          body: {
            symbol: 'NEW_BRL',
            buyThreshold: -5,
            sellThreshold: 5
          }
        };

        jobService.addSymbol.mockResolvedValue({
          symbols: [{ symbol: 'NEW_BRL', enabled: true }]
        });

        await jobController.jobAddSymbolHandler(request, mockReply);
        
        expect(jobService.addSymbol).toHaveBeenCalledWith(request.body);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          symbols: expect.arrayContaining([
            expect.objectContaining({ symbol: 'NEW_BRL' })
          ])
        }));
      });
    });

    describe('jobRemoveSymbolHandler', () => {
      it('deve remover símbolo existente', async () => {
        const request = {
          params: { symbol: 'TEST_BRL' }
        };

        jobService.removeSymbol.mockResolvedValue({
          symbols: []
        });

        await jobController.jobRemoveSymbolHandler(request, mockReply);
        
        expect(jobService.removeSymbol).toHaveBeenCalledWith('TEST_BRL');
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          symbols: []
        }));
      });
    });

    describe('jobToggleHandler', () => {
      it('deve alternar status do símbolo', async () => {
        const request = {
          params: { symbol: 'TEST_BRL' }
        };

        jobService.toggleSymbol.mockResolvedValue({
          symbols: [{ symbol: 'TEST_BRL', enabled: false }]
        });

        await jobController.jobToggleHandler(request, mockReply);
        
        expect(jobService.toggleSymbol).toHaveBeenCalledWith('TEST_BRL');
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          symbols: expect.arrayContaining([
            expect.objectContaining({ symbol: 'TEST_BRL', enabled: false })
          ])
        }));
      });
    });
  });

  describe('Handlers de preço', () => {
    describe('getPriceStatsHandler', () => {
      it('deve retornar estatísticas de preço', async () => {
        const request = {
          params: { symbol: 'TEST_BRL' }
        };

        priceTrackingService.getPriceStats.mockResolvedValue({
          success: true,
          stats: { avgPrice: 100, volatility: 5 }
        });

        await jobController.getPriceStatsHandler(request, mockReply);
        
        expect(priceTrackingService.getPriceStats).toHaveBeenCalledWith('TEST_BRL');
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          stats: expect.objectContaining({
            avgPrice: 100
          })
        }));
      });

      it('deve retornar erro quando símbolo não é encontrado', async () => {
        const request = {
          params: { symbol: 'INVALID_BRL' }
        };

        priceTrackingService.getPriceStats.mockResolvedValue({
          success: false,
          reason: 'Symbol not found'
        });

        await jobController.getPriceStatsHandler(request, mockReply);
        
        expect(mockReply.status).toHaveBeenCalledWith(404);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'Symbol not found'
        });
      });
    });

    describe('resetPriceTrackingHandler', () => {
      it('deve resetar tracking de preço', async () => {
        const request = {
          params: { symbol: 'TEST_BRL' }
        };

        // Configurar mock se não existir
        if (!priceTrackingService.resetPriceTracking) {
          priceTrackingService.resetPriceTracking = jest.fn();
        }

        priceTrackingService.resetPriceTracking.mockResolvedValue({
          success: true,
          message: 'Reset successful'
        });

        await jobController.resetPriceTrackingHandler(request, mockReply);
        
        expect(priceTrackingService.resetPriceTracking).toHaveBeenCalledWith('TEST_BRL');
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          message: 'Reset successful'
        }));
      });
    });
  });

  describe('getAllStrategiesHandler', () => {
    it('deve retornar todas as estratégias disponíveis', async () => {
      await jobController.getAllStrategiesHandler({}, mockReply);
      
      expect(mockReply.send).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
          type: expect.any(String),
          name: expect.any(String),
          description: expect.any(String),
          rule: expect.objectContaining({
            levels: expect.any(Array),
            trailingStop: expect.any(Number),
            minSellValueBRL: expect.any(Number)
          }),
          ruleDescription: expect.any(String)
        })
      ]));
    });
  });
}); 