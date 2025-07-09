const Operation = require('../models/Operation');
const { JobConfig } = require('../models/JobConfig');

class PriceTrackingService {
  /**
   * Atualiza os preços mínimos/máximos baseado no histórico de operações
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
        const minBuyPrice = lastSell.price * (1 - config.minProfitPercent / 100);
        
        if (!config.minBuyPrice || minBuyPrice < config.minBuyPrice) {
          config.minBuyPrice = minBuyPrice;
          updated = true;
          console.log(`[PRICE_TRACKING] Updated minBuyPrice for ${symbol}: ${minBuyPrice} (based on last sell: ${lastSell.price})`);
        }
      }

      // Atualizar preço máximo de venda
      if (lastBuy && lastBuy.price) {
        const maxSellPrice = lastBuy.price * (1 + config.minProfitPercent / 100);
        
        if (!config.maxSellPrice || maxSellPrice > config.maxSellPrice) {
          config.maxSellPrice = maxSellPrice;
          updated = true;
          console.log(`[PRICE_TRACKING] Updated maxSellPrice for ${symbol}: ${maxSellPrice} (based on last buy: ${lastBuy.price})`);
        }
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
        lastBuyPrice: lastBuy?.price,
        lastSellPrice: lastSell?.price
      };

    } catch (error) {
      console.error(`[PRICE_TRACKING] Error updating price tracking for ${symbol}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verifica se o preço atual é adequado para compra
   */
  async shouldBuyAtPrice(symbol, currentPrice) {
    try {
      const config = await JobConfig.findOne({ symbol });
      if (!config || !config.priceTrackingEnabled) {
        return { shouldBuy: true, reason: 'Price tracking disabled' };
      }

      // Se não há preço mínimo definido, permite compra
      if (!config.minBuyPrice) {
        return { shouldBuy: true, reason: 'No minimum buy price set' };
      }

      // Verificar se preço atual está abaixo do mínimo
      if (currentPrice >= config.minBuyPrice) {
        return { 
          shouldBuy: false, 
          reason: `Current price (${currentPrice}) >= minBuyPrice (${config.minBuyPrice})`,
          currentPrice,
          minBuyPrice: config.minBuyPrice,
          difference: ((currentPrice - config.minBuyPrice) / config.minBuyPrice * 100).toFixed(2) + '%'
        };
      }

      return { 
        shouldBuy: true, 
        reason: `Current price (${currentPrice}) < minBuyPrice (${config.minBuyPrice})`,
        currentPrice,
        minBuyPrice: config.minBuyPrice,
        discount: ((config.minBuyPrice - currentPrice) / config.minBuyPrice * 100).toFixed(2) + '%'
      };

    } catch (error) {
      console.error(`[PRICE_TRACKING] Error checking buy price for ${symbol}:`, error);
      return { shouldBuy: true, reason: 'Error checking price, allowing buy' };
    }
  }

  /**
   * Verifica se o preço atual é adequado para venda
   */
  async shouldSellAtPrice(symbol, currentPrice) {
    try {
      const config = await JobConfig.findOne({ symbol });
      if (!config || !config.priceTrackingEnabled) {
        return { shouldSell: true, reason: 'Price tracking disabled' };
      }

      // Se não há preço máximo definido, permite venda
      if (!config.maxSellPrice) {
        return { shouldSell: true, reason: 'No maximum sell price set' };
      }

      // Verificar se preço atual está acima do máximo
      if (currentPrice <= config.maxSellPrice) {
        return { 
          shouldSell: false, 
          reason: `Current price (${currentPrice}) <= maxSellPrice (${config.maxSellPrice})`,
          currentPrice,
          maxSellPrice: config.maxSellPrice,
          difference: ((config.maxSellPrice - currentPrice) / config.maxSellPrice * 100).toFixed(2) + '%'
        };
      }

      return { 
        shouldSell: true, 
        reason: `Current price (${currentPrice}) > maxSellPrice (${config.maxSellPrice})`,
        currentPrice,
        maxSellPrice: config.maxSellPrice,
        premium: ((currentPrice - config.maxSellPrice) / config.maxSellPrice * 100).toFixed(2) + '%'
      };

    } catch (error) {
      console.error(`[PRICE_TRACKING] Error checking sell price for ${symbol}:`, error);
      return { shouldSell: true, reason: 'Error checking price, allowing sell' };
    }
  }

  /**
   * Obtém estatísticas de preços para um símbolo
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
        lastBuyPrice: lastBuy?.price,
        lastSellPrice: lastSell?.price,
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

  /**
   * Reseta os preços de tracking para um símbolo
   */
  async resetPriceTracking(symbol) {
    try {
      const config = await JobConfig.findOne({ symbol });
      if (!config) {
        return { success: false, reason: 'Symbol not found' };
      }

      config.minBuyPrice = null;
      config.maxSellPrice = null;
      config.updatedAt = new Date();
      await config.save();

      console.log(`[PRICE_TRACKING] Reset price tracking for ${symbol}`);
      return { success: true, message: 'Price tracking reset successfully' };

    } catch (error) {
      console.error(`[PRICE_TRACKING] Error resetting price tracking for ${symbol}:`, error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new PriceTrackingService(); 