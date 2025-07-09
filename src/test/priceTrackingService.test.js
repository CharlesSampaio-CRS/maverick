const priceTrackingService = require('../services/priceTrackingService');
const axios = require('axios');

// Mock do JobConfig
jest.mock('../models/JobConfig', () => {
  const data = {};
  return {
    JobConfig: {
      findOne: jest.fn(async (query) => data[query.symbol] || null),
      __setMockData: (symbol, config) => { data[symbol] = config; },
      __clearMockData: () => { Object.keys(data).forEach(k => delete data[k]); }
    }
  };
});

const { JobConfig } = require('../models/JobConfig');

let realPrice = null;
beforeAll(async () => {
  const response = await axios.get('https://api.novadax.com/v1/market/ticker?symbol=MOG_BRL');
  realPrice = Number(response.data.data.lastPrice);
  console.log('Preço real MOG_BRL (NovaDAX):', realPrice);
});

describe('PriceTrackingService', () => {
  afterEach(() => {
    JobConfig.__clearMockData();
  });

  describe('shouldBuyAtPrice', () => {
    it('deve permitir compra se priceTrackingEnabled for false', async () => {
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: false });
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'priceTrackingEnabled: false');
      const result = await priceTrackingService.shouldBuyAtPrice('MOG_BRL', realPrice);
      console.log('shouldBuyAtPrice - priceTrackingEnabled false:', result);
      expect(result.shouldBuy).toBe(true);
    });

    it('deve permitir compra se não houver lastPriceBuy', async () => {
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastPriceBuy: null });
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'priceTrackingEnabled: true, lastPriceBuy: null');
      const result = await priceTrackingService.shouldBuyAtPrice('MOG_BRL', realPrice);
      console.log('shouldBuyAtPrice - no lastPriceBuy:', result);
      expect(result.shouldBuy).toBe(true);
    });

    it('não deve permitir compra se preço for igual ao limite com sellThreshold negativo', async () => {
      const sellThreshold = -15;
      const lastBuyPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastBuyPrice, sellThreshold });
      const limite = Number((lastBuyPrice * (1 + sellThreshold / 100)).toFixed(10));
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'sellThreshold:', sellThreshold, 'lastBuyPrice:', lastBuyPrice, 'limite:', limite, 'precoTestado:', limite);
      const result = await priceTrackingService.shouldBuyAtPrice('MOG_BRL', limite);
      console.log('shouldBuyAtPrice - igual ao limite:', result);
      expect(result.shouldBuy).toBe(false);
    });

    it('não deve permitir compra se preço for maior que o limite com sellThreshold negativo', async () => {
      const sellThreshold = -15;
      const lastBuyPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastBuyPrice, sellThreshold });
      const limite = Number((lastBuyPrice * (1 + sellThreshold / 100)).toFixed(10));
      const precoTestado = limite + 0.0000000001; // ligeiramente maior
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'sellThreshold:', sellThreshold, 'lastBuyPrice:', lastBuyPrice, 'limite:', limite, 'precoTestado:', precoTestado);
      const result = await priceTrackingService.shouldBuyAtPrice('MOG_BRL', precoTestado);
      console.log('shouldBuyAtPrice - maior que o limite:', result);
      expect(result.shouldBuy).toBe(false);
    });

    it('deve permitir compra se preço for menor que o limite com sellThreshold negativo', async () => {
      const sellThreshold = -15;
      const lastBuyPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastBuyPrice, sellThreshold });
      const limite = Number((lastBuyPrice * (1 + sellThreshold / 100)).toFixed(10));
      const precoTestado = limite - 0.0000000001; // ligeiramente menor
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'sellThreshold:', sellThreshold, 'lastBuyPrice:', lastBuyPrice, 'limite:', limite, 'precoTestado:', precoTestado);
      const result = await priceTrackingService.shouldBuyAtPrice('MOG_BRL', precoTestado);
      console.log('shouldBuyAtPrice - menor que o limite:', result);
      expect(result.shouldBuy).toBe(true);
    });
  });

  describe('shouldSellAtPrice', () => {
    it('deve permitir venda se priceTrackingEnabled for false', async () => {
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: false });
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'priceTrackingEnabled: false');
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', realPrice);
      console.log('shouldSellAtPrice - priceTrackingEnabled false:', result);
      expect(result.shouldSell).toBe(true);
    });

    it('deve permitir venda se não houver lastPriceSell', async () => {
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastPriceSell: null });
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'priceTrackingEnabled: true, lastPriceSell: null');
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', realPrice);
      console.log('shouldSellAtPrice - no lastPriceSell:', result);
      expect(result.shouldSell).toBe(true);
    });

    it('não deve permitir venda se preço for igual ao limite com buyThreshold negativo', async () => {
      const buyThreshold = -10;
      const lastSellPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice, buyThreshold });
      const limite = Number((lastSellPrice * (1 + buyThreshold / 100)).toFixed(10));
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'buyThreshold:', buyThreshold, 'lastSellPrice:', lastSellPrice, 'limite:', limite, 'precoTestado:', limite);
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', limite);
      console.log('shouldSellAtPrice - igual ao limite:', result);
      expect(result.shouldSell).toBe(false);
    });

    it('não deve permitir venda se preço for menor que o limite com buyThreshold negativo', async () => {
      const buyThreshold = -10;
      const lastSellPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice, buyThreshold });
      const limite = Number((lastSellPrice * (1 + buyThreshold / 100)).toFixed(10));
      const precoTestado = limite - 0.0000000001; // ligeiramente menor
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'buyThreshold:', buyThreshold, 'lastSellPrice:', lastSellPrice, 'limite:', limite, 'precoTestado:', precoTestado);
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', precoTestado);
      console.log('shouldSellAtPrice - menor que o limite:', result);
      expect(result.shouldSell).toBe(false);
    });

    it('deve permitir venda se preço for maior que o limite com buyThreshold negativo', async () => {
      const buyThreshold = -10;
      const lastSellPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice, buyThreshold });
      const limite = Number((lastSellPrice * (1 + buyThreshold / 100)).toFixed(10));
      const precoTestado = limite + 0.0000000001; // ligeiramente maior
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'buyThreshold:', buyThreshold, 'lastSellPrice:', lastSellPrice, 'limite:', limite, 'precoTestado:', precoTestado);
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', precoTestado);
      console.log('shouldSellAtPrice - maior que o limite:', result);
      expect(result.shouldSell).toBe(true);
    });
  });
}); 