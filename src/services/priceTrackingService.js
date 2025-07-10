const Operation = require('../models/Operation');
const { JobConfig } = require('../models/JobConfig');

class PriceTrackingService {
  /**
   * Atualiza os preços mínimos/máximos baseado no histórico de operações.
   */
  async updatePriceTracking(symbol) {
    try {
      // Buscar configuração do símbolo
      const config = await JobConfig.findOne({ symbol });
      if (!config || !config.priceTrackingEnabled) {
        return { success: false, reason: 'Price tracking disabled' };
      }

      // Buscar últimas operações de compra e venda
      const [lastBuy, lastSell] = await Promise.all([
        Operation.findOne({ 
          symbol, 
          type: 'buy', 
          status: 'success' 
        }).sort({ createdAt: -1 }),
        Operation.findOne({ 
          symbol, 
          type: 'sell', 
          status: 'success' 
        }).sort({ createdAt: -1 })
      ]);

      let updated = false;

      if (updated) {
        config.updatedAt = new Date();
        await config.save();
      }

      return { 
        success: true, 
        updated,
        lastBuyPrice: config.lastBuyPrice,
        lastSellPrice: config.lastSellPrice,
        lastPriceBuy: config.lastPriceBuy,
        lastPriceSell: config.lastPriceSell
      };

    } catch (error) {
      console.error(`[PRICE_TRACKING] Error updating price tracking for ${symbol}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verifica se o preço atual é adequado para compra.
   */
  async shouldBuyAtPrice(symbol, currentPrice) {
    try {
      const config = await JobConfig.findOne({ symbol });
      // Nova regra: só permite compra se buyThreshold for negativo
      if (typeof config.buyThreshold !== 'number' || config.buyThreshold >= 0) {
        return { shouldBuy: false, reason: 'buyThreshold deve ser negativo para permitir compra' };
      }

      if (config.lastSellPrice) {
        const buyThreshold = config.buyThreshold;
        const buyLimit = Number((config.lastSellPrice * (1 + buyThreshold / 100)).toFixed(10));
        const roundedCurrentPrice = Number(currentPrice.toFixed(10));
        if (roundedCurrentPrice >= buyLimit) {
          return {
            shouldBuy: false,
            reason: `Current price (${currentPrice}) >= lastSellPrice (${config.lastSellPrice}) + buyThreshold (${buyThreshold}%) = ${buyLimit}`
          };
        }
      }
      return { shouldBuy: true, reason: 'Allowed by rule' };
    } catch (error) {
      console.error(`[PRICE_TRACKING] Error checking buy price for ${symbol}:`, error);
      return { shouldBuy: true, reason: 'Error checking price, allowing buy' };
    }
  }

  /**
   * Verifica se o preço atual é adequado para venda.
   */
  async shouldSellAtPrice(symbol, currentPrice) {
    try {
      const config = await JobConfig.findOne({ symbol });
      if (!config || !config.priceTrackingEnabled) {
        return { shouldSell: true, reason: 'Price tracking disabled' };
      }

      // Nova regra: só permite venda se sellThreshold for positivo
      if (typeof config.sellThreshold !== 'number' || config.sellThreshold <= 0) {
        return { shouldSell: false, reason: 'sellThreshold deve ser positivo para permitir venda' };
      }

      if (config.lastBuyPrice) {
        const sellThreshold = config.sellThreshold;
        const sellLimit = Number((config.lastBuyPrice * (1 + sellThreshold / 100)).toFixed(10));
        const roundedCurrentPrice = Number(currentPrice.toFixed(10));
        if (roundedCurrentPrice <= sellLimit) {
          return {
            shouldSell: false,
            reason: `Current price (${currentPrice}) <= lastBuyPrice (${config.lastBuyPrice}) + sellThreshold (${sellThreshold}%) = ${sellLimit}`
          };
        }
      }
      return { shouldSell: true, reason: 'Allowed by rule' };
    } catch (error) {
      console.error(`[PRICE_TRACKING] Error checking sell price for ${symbol}:`, error);
      return { shouldSell: true, reason: 'Error checking price, allowing sell' };
    }
  }

  /**
   * Obtém estatísticas de preços para um símbolo.
   */
  async getPriceStats(symbol) {
    try {
      const config = await JobConfig.findOne({ symbol });
      if (!config) {
        return { success: false, reason: 'Symbol not configured' };
      }

      // Buscar últimas operações
      const [lastBuy, lastSell, recentOperations] = await Promise.all([
        Operation.findOne({ symbol, type: 'buy', status: 'success' }).sort({ createdAt: -1 }),
        Operation.findOne({ symbol, type: 'sell', status: 'success' }).sort({ createdAt: -1 }),
        Operation.find({ symbol, status: 'success' }).sort({ createdAt: -1 }).limit(10)
      ]);

      // Calcular estatísticas
      const buyOperations = recentOperations.filter(op => op.type === 'buy');
      const sellOperations = recentOperations.filter(op => op.type === 'sell');

      const avgBuyPrice = buyOperations.length > 0 ? 
        buyOperations.reduce((sum, op) => sum + op.price, 0) / buyOperations.length : null;
      
      const avgSellPrice = sellOperations.length > 0 ? 
        sellOperations.reduce((sum, op) => sum + op.price, 0) / sellOperations.length : null;

      return {
        success: true,
        symbol,
        priceTrackingEnabled: config.priceTrackingEnabled,
        lastBuyPrice: config.lastBuyPrice,
        lastSellPrice: config.lastSellPrice,
        minProfitPercent: config.minProfitPercent,
        avgBuyPrice,
        avgSellPrice,
        totalOperations: recentOperations.length,
        buyOperations: buyOperations.length,
        sellOperations: sellOperations.length
      };

    } catch (error) {
      console.error(`[PRICE_TRACKING] Error getting price stats for ${symbol}:`, error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new PriceTrackingService();