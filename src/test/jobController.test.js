process.env.NOVADAX_API_KEY = 'dummy';
process.env.NOVADAX_API_SECRET = 'dummy';
jest.mock('../models/JobConfig');
jest.mock('newrelic', () => ({
  recordCustomEvent: jest.fn(),
  recordMetric: jest.fn(),
  noticeError: jest.fn()
}));
jest.mock('../services/balanceService', () => ({
  getBalance: jest.fn(async (currency) => ({ available: '1000' }))
}));
jest.mock('../services/jobService', () => ({
  status: jest.fn()
}));
jest.mock('../services/tickerService', () => ({
  getTicker: jest.fn()
}));
jest.mock('../services/ordersService', () => ({
  createBuyOrder: jest.fn(async () => ({ status: 'success', _id: 'fakeid', amount: 1, price: 1 })),
  createSellOrder: jest.fn(async () => ({ status: 'success', _id: 'fakeid', amount: 1, price: 1 }))
}));

const jobController = require('../controllers/jobController');
const jobService = require('../services/jobService');
const tickerService = require('../services/tickerService');

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

  it('não permite compra se preço atual for maior ou igual ao limite de compra calculado (lastSellPrice + sellThreshold%)', async () => {
    const symbol = 'TEST_BRL';
    const lastSellPrice = 100;
    const sellThreshold = -10;
    const currentPrice = 91; // 100 + (-10%) = 90, então 91 >= 90
    const config = {
      symbols: [{ symbol, enabled: true, lastSellPrice, sellThreshold, buyThreshold: 10, lastBuyPrice: 90 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: -15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Buy skipped')
    }));
  });

  it('permite compra se preço atual for menor que o limite de compra calculado (lastSellPrice + sellThreshold%)', async () => {
    const symbol = 'TEST_BRL';
    const lastSellPrice = 100;
    const sellThreshold = -10;
    const currentPrice = 89; // 100 + (-10%) = 90, então 89 < 90
    const config = {
      symbols: [{ symbol, enabled: true, lastSellPrice, sellThreshold, buyThreshold: 10, lastBuyPrice: 90 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: -15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Buy skipped')
    }));
  });

  it('não permite venda se preço atual for menor ou igual ao limite de venda calculado (lastBuyPrice + buyThreshold%)', async () => {
    const symbol = 'TEST_BRL';
    const lastBuyPrice = 100;
    const buyThreshold = 10;
    const currentPrice = 109; // 100 + 10% = 110, então 109 <= 110
    const config = {
      symbols: [{ symbol, enabled: true, lastBuyPrice, buyThreshold, sellThreshold: -10, lastSellPrice: 120 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: 15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Sell skipped')
    }));
  });

  it('permite venda se preço atual for maior que o limite de venda calculado (lastBuyPrice + buyThreshold%)', async () => {
    const symbol = 'TEST_BRL';
    const lastBuyPrice = 100;
    const buyThreshold = 10;
    const currentPrice = 120; // 100 + 10% = 110, então 120 > 110
    const config = {
      symbols: [{ symbol, enabled: true, lastBuyPrice, buyThreshold, sellThreshold: -10, lastSellPrice: 120 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: 15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Sell skipped')
    }));
  });

  it('permite compra quando não existe lastSellPrice definido', async () => {
    const symbol = 'TEST_BRL';
    const sellThreshold = -10;
    const currentPrice = 100;
    const config = {
      symbols: [{ symbol, enabled: true, sellThreshold, buyThreshold: 10, lastBuyPrice: 90 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: -15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Buy skipped')
    }));
  });

  it('permite venda quando não existe lastBuyPrice definido', async () => {
    const symbol = 'TEST_BRL';
    const buyThreshold = 10;
    const currentPrice = 120;
    const config = {
      symbols: [{ symbol, enabled: true, buyThreshold, sellThreshold: -10, lastSellPrice: 120 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: 15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Sell skipped')
    }));
  });

  it('não permite compra se sellThreshold for zero ou positivo', async () => {
    const symbol = 'TEST_BRL';
    const lastSellPrice = 100;
    const sellThreshold = 10; // POSITIVO!
    const currentPrice = 89;
    const config = {
      symbols: [{ symbol, enabled: true, lastSellPrice, sellThreshold, buyThreshold: 10, lastBuyPrice: 90 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: -15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Buy not allowed')
    }));
  });

  it('não permite venda se buyThreshold for negativo', async () => {
    const symbol = 'TEST_BRL';
    const lastBuyPrice = 100;
    const buyThreshold = -10; // NEGATIVO!
    const currentPrice = 120;
    const config = {
      symbols: [{ symbol, enabled: true, lastBuyPrice, buyThreshold, sellThreshold: -10, lastSellPrice: 120 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: 15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Sell not allowed')
    }));
  });

  it('não permite venda se buyThreshold for zero', async () => {
    const symbol = 'TEST_BRL';
    const lastBuyPrice = 100;
    const buyThreshold = 0; // ZERO!
    const currentPrice = 120;
    const config = {
      symbols: [{ symbol, enabled: true, lastBuyPrice, buyThreshold, sellThreshold: -10, lastSellPrice: 120 }],
      enabled: true
    };
    const ticker = { success: true, lastPrice: currentPrice, changePercent24h: 15 };
    jobService.status.mockResolvedValue(config);
    tickerService.getTicker.mockResolvedValue(ticker);
    const reply = createReply();
    await jobController.jobRunHandler({ body: { symbol } }, reply);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining('Sell not allowed')
    }));
  });
}); 