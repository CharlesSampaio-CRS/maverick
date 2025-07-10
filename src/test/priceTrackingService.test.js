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
  // Teste usa a API pública da NovaDAX, mas o bot é Maverick
  const response = await axios.get('https://api.novadax.com/v1/market/ticker?symbol=MOG_BRL');
  realPrice = Number(response.data.data.lastPrice);
  console.log('Preço real MOG_BRL (Maverick):', realPrice);
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

    it('deve permitir compra se não houver lastBuyPrice', async () => {
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastBuyPrice: null, sellThreshold: -10 });
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'priceTrackingEnabled: true, lastBuyPrice: null, sellThreshold: -10');
      const result = await priceTrackingService.shouldBuyAtPrice('MOG_BRL', realPrice);
      console.log('shouldBuyAtPrice - no lastBuyPrice:', result);
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

    it('deve permitir venda se não houver lastSellPrice', async () => {
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice: null, buyThreshold: 10 });
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'priceTrackingEnabled: true, lastSellPrice: null, buyThreshold: 10');
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', realPrice);
      console.log('shouldSellAtPrice - no lastSellPrice:', result);
      expect(result.shouldSell).toBe(true);
    });

    it('não deve permitir venda se preço for igual ao limite com buyThreshold positivo', async () => {
      const buyThreshold = 10;
      const lastSellPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice, buyThreshold });
      const limite = Number((lastSellPrice * (1 + buyThreshold / 100)).toFixed(10));
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'buyThreshold:', buyThreshold, 'lastSellPrice:', lastSellPrice, 'limite:', limite, 'precoTestado:', limite);
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', limite);
      console.log('shouldSellAtPrice - igual ao limite:', result);
      expect(result.shouldSell).toBe(false);
    });

    it('não deve permitir venda se preço for menor que o limite com buyThreshold positivo', async () => {
      const buyThreshold = 10;
      const lastSellPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice, buyThreshold });
      const limite = Number((lastSellPrice * (1 + buyThreshold / 100)).toFixed(10));
      const precoTestado = limite - 0.0000000001; // ligeiramente menor
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'buyThreshold:', buyThreshold, 'lastSellPrice:', lastSellPrice, 'limite:', limite, 'precoTestado:', precoTestado);
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', precoTestado);
      console.log('shouldSellAtPrice - menor que o limite:', result);
      expect(result.shouldSell).toBe(false);
    });

    it('deve permitir venda se preço for maior que o limite com buyThreshold positivo', async () => {
      const buyThreshold = 10;
      const lastSellPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice, buyThreshold });
      const limite = Number((lastSellPrice * (1 + buyThreshold / 100)).toFixed(10));
      const precoTestado = limite + 0.0000000001; // ligeiramente maior
      console.log('[DEBUG TESTE] realPrice:', realPrice, 'buyThreshold:', buyThreshold, 'lastSellPrice:', lastSellPrice, 'limite:', limite, 'precoTestado:', precoTestado);
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', precoTestado);
      console.log('shouldSellAtPrice - maior que o limite:', result);
      expect(result.shouldSell).toBe(true);
    });

    it('não deve permitir venda se buyThreshold for negativo', async () => {
      const buyThreshold = -10;
      const lastSellPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice, buyThreshold });
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', realPrice);
      expect(result.shouldSell).toBe(false);
    });

    it('não deve permitir venda se buyThreshold for zero', async () => {
      const buyThreshold = 0;
      const lastSellPrice = realPrice;
      JobConfig.__setMockData('MOG_BRL', { priceTrackingEnabled: true, lastSellPrice, buyThreshold });
      const result = await priceTrackingService.shouldSellAtPrice('MOG_BRL', realPrice);
      expect(result.shouldSell).toBe(false);
    });
  });
}); 