const priceTrackingService = require('../services/priceTrackingService');

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

describe('PriceTrackingService', () => {
  afterEach(() => {
    JobConfig.__clearMockData();
  });

  describe('shouldBuyAtPrice', () => {
    it('deve permitir compra quando buyThreshold for negativo', async () => {
      JobConfig.__setMockData('TEST_BRL', { 
        buyThreshold: -10,
        lastSellPrice: 100
      });
      // O limite é 90, então use 89 para permitir a compra
      const result = await priceTrackingService.shouldBuyAtPrice('TEST_BRL', 89);
      expect(result.shouldBuy).toBe(true);
      expect(result.reason).toContain('Allowed by rule');
    });

    it('não deve permitir compra quando buyThreshold for positivo', async () => {
      JobConfig.__setMockData('TEST_BRL', { 
        buyThreshold: 10,
        lastSellPrice: 100
      });
      
      const result = await priceTrackingService.shouldBuyAtPrice('TEST_BRL', 100);
      
      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain('buyThreshold deve ser negativo para permitir compra');
    });

    it('não deve permitir compra quando buyThreshold for zero', async () => {
      JobConfig.__setMockData('TEST_BRL', { 
        buyThreshold: 0,
        lastSellPrice: 100
      });
      
      const result = await priceTrackingService.shouldBuyAtPrice('TEST_BRL', 100);
      
      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain('buyThreshold deve ser negativo para permitir compra');
    });

    it('não deve permitir compra quando preço atual >= limite baseado em lastSellPrice', async () => {
      const buyThreshold = -15;
      const lastSellPrice = 100;
      const currentPrice = 86; // 100 + (-15%) = 85, então 86 >= 85
      
      JobConfig.__setMockData('TEST_BRL', { 
        buyThreshold,
        lastSellPrice
      });
      
      const result = await priceTrackingService.shouldBuyAtPrice('TEST_BRL', currentPrice);
      
      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain('Current price');
    });

    it('deve permitir compra quando preço atual < limite baseado em lastSellPrice', async () => {
      const buyThreshold = -15;
      const lastSellPrice = 100;
      const currentPrice = 84; // 100 + (-15%) = 85, então 84 < 85
      
      JobConfig.__setMockData('TEST_BRL', { 
        buyThreshold,
        lastSellPrice
      });
      
      const result = await priceTrackingService.shouldBuyAtPrice('TEST_BRL', currentPrice);
      
      expect(result.shouldBuy).toBe(true);
      expect(result.reason).toContain('Allowed by rule');
    });

    it('deve permitir compra quando não houver lastSellPrice', async () => {
      JobConfig.__setMockData('TEST_BRL', { 
        buyThreshold: -10,
        lastSellPrice: null
      });
      
      const result = await priceTrackingService.shouldBuyAtPrice('TEST_BRL', 100);
      
      expect(result.shouldBuy).toBe(true);
      expect(result.reason).toContain('Allowed by rule');
    });
  });

  describe('shouldSellAtPrice', () => {
    it('deve permitir venda quando priceTrackingEnabled for false', async () => {
      JobConfig.__setMockData('TEST_BRL', { priceTrackingEnabled: false });
      
      const result = await priceTrackingService.shouldSellAtPrice('TEST_BRL', 100);
      
      expect(result.shouldSell).toBe(true);
      expect(result.reason).toContain('Price tracking disabled');
    });

    it('deve permitir venda quando sellThreshold for positivo', async () => {
      JobConfig.__setMockData('TEST_BRL', { 
        priceTrackingEnabled: true,
        sellThreshold: 10,
        lastSellPrice: 100
      });
      
      const result = await priceTrackingService.shouldSellAtPrice('TEST_BRL', 100);
      
      expect(result.shouldSell).toBe(true);
      expect(result.reason).toContain('Allowed by rule');
    });

    it('não deve permitir venda quando sellThreshold for negativo', async () => {
      JobConfig.__setMockData('TEST_BRL', { 
        priceTrackingEnabled: true,
        sellThreshold: -10,
        lastSellPrice: 100
      });
      
      const result = await priceTrackingService.shouldSellAtPrice('TEST_BRL', 100);
      
      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain('sellThreshold deve ser positivo para permitir venda');
    });

    it('não deve permitir venda quando sellThreshold for zero', async () => {
      JobConfig.__setMockData('TEST_BRL', { 
        priceTrackingEnabled: true,
        sellThreshold: 0,
        lastSellPrice: 100
      });
      
      const result = await priceTrackingService.shouldSellAtPrice('TEST_BRL', 100);
      
      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain('sellThreshold deve ser positivo para permitir venda');
    });

    it('não deve permitir venda quando preço atual <= limite baseado em lastSellPrice', async () => {
      const buyThreshold = 10;
      const lastSellPrice = 100;
      const currentPrice = 109; // 100 + 10% = 110, então 109 <= 110
      
      JobConfig.__setMockData('TEST_BRL', { 
        priceTrackingEnabled: true,
        sellThreshold: 10,
        buyThreshold,
        lastSellPrice
      });
      
      const result = await priceTrackingService.shouldSellAtPrice('TEST_BRL', currentPrice);
      
      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain('Current price');
    });

    it('deve permitir venda quando preço atual > limite baseado em lastSellPrice', async () => {
      const buyThreshold = 10;
      const lastSellPrice = 100;
      const currentPrice = 111; // 100 + 10% = 110, então 111 > 110
      
      JobConfig.__setMockData('TEST_BRL', { 
        priceTrackingEnabled: true,
        sellThreshold: 10,
        buyThreshold,
        lastSellPrice
      });
      
      const result = await priceTrackingService.shouldSellAtPrice('TEST_BRL', currentPrice);
      
      expect(result.shouldSell).toBe(true);
      expect(result.reason).toContain('Allowed by rule');
    });

    it('deve permitir venda quando não houver lastSellPrice', async () => {
      JobConfig.__setMockData('TEST_BRL', { 
        priceTrackingEnabled: true,
        sellThreshold: 10,
        lastSellPrice: null
      });
      
      const result = await priceTrackingService.shouldSellAtPrice('TEST_BRL', 100);
      
      expect(result.shouldSell).toBe(true);
      expect(result.reason).toContain('Allowed by rule');
    });
  });
}); 