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

      // Atualizar preço mínimo de compra
      if (lastSell && lastSell.price) {
        // Usa buyThreshold (ex: -8 para -8%)
        const buyThreshold = typeof config.buyThreshold === 'number' ? config.buyThreshold : -2;
        const minBuyPrice = lastSell.price * (1 + (buyThreshold / 100));
        if (!config.minBuyPrice || minBuyPrice < config.minBuyPrice) {
          config.minBuyPrice = minBuyPrice;
          updated = true;
          console.log(`[PRICE_TRACKING] Updated minBuyPrice for ${symbol}: ${minBuyPrice} (based on last sell: ${lastSell.price}, buyThreshold: ${buyThreshold}%)`);
        }
        // Salva o valor da última venda
        config.lastPriceSell = lastSell.price;
      }

      // Atualizar preço máximo de venda
      if (lastBuy && lastBuy.price) {
        // Usa sellThreshold (ex: 10 para +10%)
        const sellThreshold = typeof config.sellThreshold === 'number' ? config.sellThreshold : 2;
        const maxSellPrice = lastBuy.price * (1 + (sellThreshold / 100));
        if (!config.maxSellPrice || maxSellPrice > config.maxSellPrice) {
          config.maxSellPrice = maxSellPrice;
          updated = true;
          console.log(`[PRICE_TRACKING] Updated maxSellPrice for ${symbol}: ${maxSellPrice} (based on last buy: ${lastBuy.price}, sellThreshold: ${sellThreshold}%)`);
        }
        // Salva o valor da última compra
        config.lastPriceBuy = lastBuy.price;
      }

      if (updated) {
        config.updatedAt = new Date();
        await config.save();
      }

      return { 
        success: true, 
        updated,
        minBuyPrice: config.minBuyPrice,
        maxSellPrice: config.maxSellPrice,
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
      if (!config || !config.priceTrackingEnabled) {
        return { shouldBuy: true, reason: 'Price tracking disabled' };
      }

      // Se não há lastPriceBuy, permite compra
      if (!config.lastPriceBuy) {
        return { shouldBuy: true, reason: 'No lastPriceBuy set' };
      }

      // Considera o sellThreshold como margem para nova compra
      const sellThreshold = typeof config.sellThreshold === 'number' ? config.sellThreshold : 0;
      const buyLimit = Number((config.lastPriceBuy * (1 + sellThreshold / 100)).toFixed(10));
      const roundedCurrentPrice = Number(currentPrice.toFixed(10));
      console.log('[DEBUG shouldBuyAtPrice] roundedCurrentPrice:', roundedCurrentPrice, 'buyLimit:', buyLimit);
      if (roundedCurrentPrice >= buyLimit) {
        return {
          shouldBuy: false,
          reason: `Current price (${currentPrice}) >= lastPriceBuy (${config.lastPriceBuy}) + sellThreshold (${sellThreshold}%) = ${buyLimit}`
        };
      }

      return {
        shouldBuy: true,
        reason: `Current price (${currentPrice}) < lastPriceBuy (${config.lastPriceBuy}) + sellThreshold (${sellThreshold}%) = ${buyLimit}`
      };

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

      // Se não há lastPriceSell, permite venda
      if (!config.lastPriceSell) {
        return { shouldSell: true, reason: 'No lastPriceSell set' };
      }

      // Considera o buyThreshold como margem para nova venda
      const buyThreshold = typeof config.buyThreshold === 'number' ? config.buyThreshold : 0;
      const sellLimit = Number((config.lastPriceSell * (1 + buyThreshold / 100)).toFixed(10));
      const roundedCurrentPrice = Number(currentPrice.toFixed(10));
      if (roundedCurrentPrice <= sellLimit) {
        return {
          shouldSell: false,
          reason: `Current price (${currentPrice}) <= lastPriceSell (${config.lastPriceSell}) + buyThreshold (${buyThreshold}%) = ${sellLimit}`
        };
      }

      return {
        shouldSell: true,
        reason: `Current price (${currentPrice}) > lastPriceSell (${config.lastPriceSell}) + buyThreshold (${buyThreshold}%) = ${sellLimit}`
      };

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
        minBuyPrice: config.minBuyPrice,
        maxSellPrice: config.maxSellPrice,
        minProfitPercent: config.minProfitPercent,
        lastPriceBuy: config.lastPriceBuy,
        lastPriceSell: config.lastPriceSell,
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