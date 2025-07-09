process.env.NOVADAX_API_KEY = 'dummy';
process.env.NOVADAX_API_SECRET = 'dummy';
const jobController = require('../controllers/jobController');
const { JobConfig } = require('../models/JobConfig');

jest.mock('../models/JobConfig');
jest.mock('newrelic', () => ({}));

// Mock reply object
function createReply() {
  return {
    send: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
}

describe('jobRunHandler - regras de compra e venda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deve bloquear compra se preço atual >= lastSellPrice + sellThreshold%', async () => {
    const symbol = 'TEST_BRL';
    const lastSellPrice = 100;
    const sellThreshold = 10; // 10%
    const currentPrice = 111; // 100 + 10% = 110, então 111 >= 110
    const config = {
      symbols: [{
        symbol,
        enabled: true,
        lastSellPrice,
        sellThreshold,
        buyThreshold: -10,
        lastBuyPrice: 90,
      }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: -15 };
    const jobService = { status: jest.fn().mockResolvedValue(config) };
    const tickerService = { getTicker: jest.fn().mockResolvedValue(ticker) };
    jobController.__set__('jobService', jobService);
    jobController.__set__('tickerService', tickerService);

    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Buy skipped')
    }));
  });

  it('deve permitir compra se preço atual < lastSellPrice + sellThreshold%', async () => {
    const symbol = 'TEST_BRL';
    const lastSellPrice = 100;
    const sellThreshold = 10; // 10%
    const currentPrice = 105; // 100 + 10% = 110, então 105 < 110
    const config = {
      symbols: [{
        symbol,
        enabled: true,
        lastSellPrice,
        sellThreshold,
        buyThreshold: -10,
        lastBuyPrice: 90,
      }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: -15 };
    const jobService = { status: jest.fn().mockResolvedValue(config) };
    const tickerService = { getTicker: jest.fn().mockResolvedValue(ticker) };
    jobController.__set__('jobService', jobService);
    jobController.__set__('tickerService', tickerService);

    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    // Não deve bloquear por preço
    expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Buy skipped')
    }));
  });

  it('deve bloquear venda se preço atual <= lastBuyPrice + buyThreshold%', async () => {
    const symbol = 'TEST_BRL';
    const lastBuyPrice = 100;
    const buyThreshold = 10; // 10%
    const currentPrice = 109; // 100 + 10% = 110, então 109 <= 110
    const config = {
      symbols: [{
        symbol,
        enabled: true,
        lastBuyPrice,
        buyThreshold,
        sellThreshold: 10,
        lastSellPrice: 120,
      }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: 15 };
    const jobService = { status: jest.fn().mockResolvedValue(config) };
    const tickerService = { getTicker: jest.fn().mockResolvedValue(ticker) };
    jobController.__set__('jobService', jobService);
    jobController.__set__('tickerService', tickerService);

    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Sell skipped')
    }));
  });

  it('deve permitir venda se preço atual > lastBuyPrice + buyThreshold%', async () => {
    const symbol = 'TEST_BRL';
    const lastBuyPrice = 100;
    const buyThreshold = 10; // 10%
    const currentPrice = 120; // 100 + 10% = 110, então 120 > 110
    const config = {
      symbols: [{
        symbol,
        enabled: true,
        lastBuyPrice,
        buyThreshold,
        sellThreshold: 10,
        lastSellPrice: 120,
      }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: 15 };
    const jobService = { status: jest.fn().mockResolvedValue(config) };
    const tickerService = { getTicker: jest.fn().mockResolvedValue(ticker) };
    jobController.__set__('jobService', jobService);
    jobController.__set__('tickerService', tickerService);

    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    // Não deve bloquear por preço
    expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Sell skipped')
    }));
  });

  it('deve permitir compra se não houver lastSellPrice', async () => {
    const symbol = 'TEST_BRL';
    const sellThreshold = 10;
    const currentPrice = 100;
    const config = {
      symbols: [{
        symbol,
        enabled: true,
        sellThreshold,
        buyThreshold: -10,
        lastBuyPrice: 90,
      }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: -15 };
    const jobService = { status: jest.fn().mockResolvedValue(config) };
    const tickerService = { getTicker: jest.fn().mockResolvedValue(ticker) };
    jobController.__set__('jobService', jobService);
    jobController.__set__('tickerService', tickerService);

    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    // Não deve bloquear por falta de lastSellPrice
    expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Buy skipped')
    }));
  });

  it('deve permitir venda se não houver lastBuyPrice', async () => {
    const symbol = 'TEST_BRL';
    const buyThreshold = 10;
    const currentPrice = 120;
    const config = {
      symbols: [{
        symbol,
        enabled: true,
        buyThreshold,
        sellThreshold: 10,
        lastSellPrice: 120,
      }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: 15 };
    const jobService = { status: jest.fn().mockResolvedValue(config) };
    const tickerService = { getTicker: jest.fn().mockResolvedValue(ticker) };
    jobController.__set__('jobService', jobService);
    jobController.__set__('tickerService', tickerService);

    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    // Não deve bloquear por falta de lastBuyPrice
    expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Sell skipped')
    }));
  });
}); 