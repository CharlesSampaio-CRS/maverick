const newrelic = require('newrelic');
const jobService = require('../services/jobService');
const tickerService = require('../services/tickerService');
const balanceService = require('../services/balanceService');
const ordersService = require('../services/ordersService');
const priceTrackingService = require('../services/priceTrackingService');
const Operation = require('../models/Operation');
const cron = require('node-cron');
const sellStrategies = require('../utils/sellStrategies');
const { JobConfig } = require('../models/JobConfig'); // Corrigido para destructuring

// New Relic logging helpers
function logJobEvent(eventType, symbol, data = {}) {
  try {
    newrelic.recordCustomEvent('JobExecution', {
      eventType,
      symbol,
      timestamp: new Date().toISOString(),
      ...data
    });
  } catch (err) {
    console.error('[NEWRELIC] Error logging job event:', err.message);
  }
}

function logJobMetric(metricName, symbol, value) {
  try {
    newrelic.recordMetric(`Custom/Job/${metricName}/${symbol}`, value);
  } catch (err) {
    console.error('[NEWRELIC] Error logging job metric:', err.message);
  }
}

function logJobError(symbol, error, context = {}) {
  try {
    newrelic.recordCustomEvent('JobError', {
      symbol,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ...context
    });
    newrelic.noticeError(error);
  } catch (err) {
    console.error('[NEWRELIC] Error logging job error:', err.message);
  }
}

// In-memory storage for last execution times
const lastExecutions = new Map();
// In-memory storage for partial sales state with enhanced tracking
const partialSales = new Map();

// Enhanced monitoring classes
class BuyMonitoringTracker {
  constructor(symbol, initialPrice, buyThreshold, monitorMinutes = 60, buyOnRisePercent = 2.5) {
    this.symbol = symbol;
    this.initialPrice = initialPrice;
    this.buyThreshold = buyThreshold;
    this.monitorMinutes = monitorMinutes;
    this.buyOnRisePercent = buyOnRisePercent;
    this.lowestPrice = initialPrice;
    this.startTime = Date.now();
    this.lastUpdate = Date.now();
  }

  updatePrice(currentPrice) {
    this.lastUpdate = Date.now();
    if (currentPrice < this.lowestPrice) {
      this.lowestPrice = currentPrice;
    }
  }

  shouldBuy(currentPrice) {
    const timeElapsed = (Date.now() - this.startTime) / (1000 * 60); // minutes
    const priceRisePercent = ((currentPrice - this.lowestPrice) / this.lowestPrice) * 100;
    
    // Buy if time expired
    if (timeElapsed >= this.monitorMinutes) {
      return {
        shouldBuy: true,
        reason: `Time expired (${timeElapsed.toFixed(1)}min >= ${this.monitorMinutes}min)`,
        price: currentPrice,
        lowestPrice: this.lowestPrice
      };
    }
    
    // Buy if price rose significantly from lowest
    if (priceRisePercent >= this.buyOnRisePercent) {
      return {
        shouldBuy: true,
        reason: `Price rose ${priceRisePercent.toFixed(2)}% from lowest (${this.lowestPrice})`,
        price: currentPrice,
        lowestPrice: this.lowestPrice
      };
    }
    
    return { shouldBuy: false };
  }

  getStatus() {
    const timeElapsed = (Date.now() - this.startTime) / (1000 * 60);
    const remainingTime = Math.max(0, this.monitorMinutes - timeElapsed);
    return {
      symbol: this.symbol,
      initialPrice: this.initialPrice,
      currentLowestPrice: this.lowestPrice,
      timeElapsed: timeElapsed.toFixed(1),
      remainingTime: remainingTime.toFixed(1),
      buyThreshold: this.buyThreshold,
      monitorMinutes: this.monitorMinutes,
      buyOnRisePercent: this.buyOnRisePercent
    };
  }
}

class SellMonitoringTracker {
  constructor(symbol, initialPrice, sellThreshold, monitorMinutes = 60, sellOnDropPercent = 2.5) {
    this.symbol = symbol;
    this.initialPrice = initialPrice;
    this.sellThreshold = sellThreshold;
    this.monitorMinutes = monitorMinutes;
    this.sellOnDropPercent = sellOnDropPercent;
    this.highestPrice = initialPrice;
    this.startTime = Date.now();
    this.lastUpdate = Date.now();
  }

  updatePrice(currentPrice) {
    this.lastUpdate = Date.now();
    if (currentPrice > this.highestPrice) {
      this.highestPrice = currentPrice;
    }
  }

  shouldSell(currentPrice) {
    const timeElapsed = (Date.now() - this.startTime) / (1000 * 60); // minutes
    const priceDropPercent = ((this.highestPrice - currentPrice) / this.highestPrice) * 100;
    
    // Sell if time expired
    if (timeElapsed >= this.monitorMinutes) {
      return {
        shouldSell: true,
        reason: `Time expired (${timeElapsed.toFixed(1)}min >= ${this.monitorMinutes}min)`,
        price: currentPrice,
        highestPrice: this.highestPrice
      };
    }
    
    // Sell if price dropped significantly from peak
    if (priceDropPercent >= this.sellOnDropPercent) {
      return {
        shouldSell: true,
        reason: `Price dropped ${priceDropPercent.toFixed(2)}% from peak (${this.highestPrice})`,
        price: currentPrice,
        highestPrice: this.highestPrice
      };
    }
    
    return { shouldSell: false };
  }

  getStatus() {
    const timeElapsed = (Date.now() - this.startTime) / (1000 * 60);
    const remainingTime = Math.max(0, this.monitorMinutes - timeElapsed);
    return {
      symbol: this.symbol,
      initialPrice: this.initialPrice,
      currentHighestPrice: this.highestPrice,
      timeElapsed: timeElapsed.toFixed(1),
      remainingTime: remainingTime.toFixed(1),
      sellThreshold: this.sellThreshold,
      monitorMinutes: this.monitorMinutes,
      sellOnDropPercent: this.sellOnDropPercent
    };
  }
}

// Função para obter configuração de estratégia por símbolo
function getStrategyConfig(symbolConfig) {
  const strategyType = symbolConfig.sellStrategy || 'security';
  return sellStrategies[strategyType] || sellStrategies.security;
}

// Enhanced partial sales tracking
class PartialSaleTracker {
  constructor(symbol, initialAmount, firstSellPrice, strategyConfig) {
    this.symbol = symbol;
    this.initialAmount = initialAmount;
    this.firstSellPrice = firstSellPrice;
    this.remainingAmount = initialAmount;
    this.highestPrice = firstSellPrice;
    this.strategyConfig = strategyConfig;
    this.sellLevels = strategyConfig.levels.map((level, idx) => ({
      percentage: level.percentage,
      price: firstSellPrice * (1 + level.priceIncrease),
      executed: idx === 0 // first sale already executed
    }));
    this.remainingAmount -= initialAmount * this.sellLevels[0].percentage;
    this.trailingStop = firstSellPrice * (1 - strategyConfig.trailingStop);
    this.lastUpdate = Date.now();
  }

  updateHighestPrice(currentPrice) {
    if (currentPrice > this.highestPrice) {
      this.highestPrice = currentPrice;
      // Update trailing stop (keeps 5% below the highest price)
      this.trailingStop = Math.max(this.trailingStop, currentPrice * 0.95);
    }
  }

  shouldSell(currentPrice) {
    // Check if any sale level is reached
    for (let level of this.sellLevels) {
      if (!level.executed && currentPrice >= level.price) {
        return {
          shouldSell: true,
          amount: this.initialAmount * level.percentage,
          reason: `Price target reached: ${currentPrice} >= ${level.price}`,
          level: level
        };
      }
    }

    // Check trailing stop
    if (currentPrice <= this.trailingStop && this.remainingAmount > 0) {
      return {
        shouldSell: true,
        amount: this.remainingAmount,
        reason: `Trailing stop triggered: ${currentPrice} <= ${this.trailingStop}`,
        level: { percentage: 1, price: currentPrice, executed: true }
      };
    }

    return { shouldSell: false };
  }

  markLevelExecuted(level) {
    level.executed = true;
    this.remainingAmount -= this.initialAmount * level.percentage;
  }

  isComplete() {
    return this.remainingAmount <= 0;
  }

  getProfitMetrics() {
    const avgSellPrice = this.sellLevels
      .filter(l => l.executed)
      .reduce((sum, l) => sum + (l.price * l.percentage), 0) / 
      this.sellLevels.filter(l => l.executed).reduce((sum, l) => sum + l.percentage, 0);
    
    return {
      avgSellPrice,
      profitPercent: ((avgSellPrice / this.firstSellPrice - 1) * 100).toFixed(2),
      highestPrice: this.highestPrice,
      maxProfitPercent: ((this.highestPrice / this.firstSellPrice - 1) * 100).toFixed(2)
    };
  }
}

// Cleanup old strategies (older than 24 hours)
function cleanupOldStrategies() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  let cleanedCount = 0;
  
  for (const [symbol, tracker] of partialSales.entries()) {
    if (now - tracker.lastUpdate > maxAge) {
      console.log(`[JOB] Cleanup | Removing old strategy for ${symbol} | Age: ${((now - tracker.lastUpdate) / (60 * 60 * 1000)).toFixed(1)}h`);
      
      // Log cleanup event
      logJobEvent('strategy_cleanup', symbol, {
        age: ((now - tracker.lastUpdate) / (60 * 60 * 1000)).toFixed(1),
        initialAmount: tracker.initialAmount,
        remainingAmount: tracker.remainingAmount,
        highestPrice: tracker.highestPrice,
        profitMetrics: tracker.getProfitMetrics()
      });
      
      partialSales.delete(symbol);
      cleanedCount++;
    }
  }
  
  // Cleanup old buy monitoring (older than 2 hours)
  // [REMOVER] buyMonitoringState, sellMonitoringState, BuyMonitoringTracker, SellMonitoringTracker, getMonitoringStatusHandler, stopMonitoringHandler, e qualquer uso relacionado
  
  // Cleanup old sell monitoring (older than 2 hours)
  // [REMOVER] buyMonitoringState, sellMonitoringState, BuyMonitoringTracker, SellMonitoringTracker, getMonitoringStatusHandler, stopMonitoringHandler, e qualquer uso relacionado
  
  // Log cleanup summary
  if (cleanedCount > 0) {
    logJobEvent('cleanup_summary', 'system', {
      cleanedCount,
      remainingStrategies: partialSales.size,
      remainingBuyMonitoring: 0, // [REMOVER] buyMonitoringState.size,
      remainingSellMonitoring: 0, // [REMOVER] sellMonitoringState.size,
      timestamp: new Date().toISOString()
    });
  }
}

// Run cleanup every hour
setInterval(cleanupOldStrategies, 60 * 60 * 1000);

/**
 * Handler principal do job de monitoramento automático.
 * Executa lógica de thresholds, monitoramento e ordens.
 */
async function jobRunHandler(request, reply) {
  let symbol;
  try {
    ({ symbol } = request.body);
    const nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
    
    // Log job start
    logJobEvent('started', symbol, { timestamp: nowStr });
    
    if (!symbol) {
      const error = 'Symbol not provided';
      console.log(`[JOB] Failure | Symbol not provided | Date: ${nowStr}`);
      logJobEvent('failed', symbol, { reason: error, timestamp: nowStr });
      return reply.status(400).send({ error });
    }

    // 1. Get job configuration and ticker data in parallel
    const [config, ticker] = await Promise.all([
      jobService.status(),
      tickerService.getTicker(symbol)
    ]);
    
    const symbolConfig = config.symbols.find(s => s.symbol === symbol);
    
    if (!symbolConfig || !symbolConfig.enabled) {
      const reason = 'symbol disabled';
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Reason: ${reason} | Date: ${nowStr}`);
      logJobEvent('skipped', symbol, { reason, timestamp: nowStr });
      return reply.send({ success: false, message: 'Symbol is disabled' });
    }

    if (!ticker.success) {
      const reason = 'error getting ticker';
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Reason: ${reason} | Date: ${nowStr}`);
      logJobEvent('failed', symbol, { reason, tickerError: ticker.error, timestamp: nowStr });
      return reply.send({ success: false, message: 'Error getting ticker data' });
    }

    // Log ticker data
    logJobMetric('price', symbol, parseFloat(ticker.lastPrice));
    logJobMetric('change24h', symbol, parseFloat(ticker.changePercent24h));

    // 2. Check thresholds e decidir ação
    const change = parseFloat(ticker.changePercent24h);
    let action = null;

    if (!action) {
      // Regra de COMPRA: comprar se a variação 24h for menor ou igual ao buyThreshold
      if (change <= symbolConfig.buyThreshold) {
        // Verifica saldo BRL para compra
        const balance = await balanceService.getBalance('BRL');
        const max = parseFloat(balance.available);
        if (max >= 25) { // mínimo R$10
          action = 'buy';
        } 
      } 
      // Regra de VENDA: vender se a variação 24h for maior ou igual ao sellThreshold
      if (change >= symbolConfig.sellThreshold) {
        // Verifica saldo da moeda base para venda
        const baseCurrency = symbol.split('_')[0];
        const balance = await balanceService.getBalance(baseCurrency);
        const amount = parseFloat(balance.available);
        if (amount > 1) {
          action = 'sell';
        }
      }
    }

    if(!action){
      return reply.send({ success: false, message: 'No buy or sell condition met. Price is outside buy/sell thresholds.' });
    }


    // 4. Execute order
    if (action === 'buy') {
      const currentPrice = parseFloat(ticker.lastPrice);
      // NOVO: Só permite comprar se sellThreshold for negativo
      if (typeof symbolConfig.sellThreshold !== 'number' || symbolConfig.sellThreshold >= 0) {
        return reply.send({
          success: false,
          message: `Buy not allowed: sellThreshold must be negative (current: ${symbolConfig.sellThreshold})`
        });
      }
      // Só permite comprar se o preço atual for menor que lastSellPrice + sellThreshold%
      if (symbolConfig.lastSellPrice) {
        const buyLimit = symbolConfig.lastSellPrice * (1 + (symbolConfig.sellThreshold / 100));
        if (currentPrice >= buyLimit) {
          return reply.send({
            success: false,
            message: `Buy skipped: current price (${currentPrice}) is not less than lastSellPrice (${symbolConfig.lastSellPrice}) + sellThreshold (${symbolConfig.sellThreshold}%) = ${buyLimit}`
          });
        }
      }
      // Verificar se o preço atual é adequado para compra
      const priceCheck = await priceTrackingService.shouldBuyAtPrice(symbol, currentPrice);
      if (!priceCheck.shouldBuy) {
        const reason = `price check failed: ${priceCheck.reason}`;
        console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${currentPrice} | 24h change: ${ticker.changePercent24h}% | Reason: ${reason} | Date: ${nowStr}`);
        logJobEvent('buy_skipped', symbol, { 
          reason, 
          currentPrice,
          priceCheck,
          change24h: ticker.changePercent24h,
          timestamp: nowStr 
        });
        return reply.send({ 
          success: false, 
          message: `Buy skipped: ${priceCheck.reason}`,
          priceCheck
        });
      }
      
      // Get BRL balance
      const balance = await balanceService.getBalance('BRL');
      const max = parseFloat(balance.available);
      let amount = Math.max(Math.floor(max), 10); // minimum R$10
      
      if (amount < 25) {
        const reason = 'insufficient BRL balance';
        console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Reason: ${reason} | Date: ${nowStr}`);
        logJobEvent('failed', symbol, { 
          reason, 
          availableBalance: max,
          requiredMin: 10,
          price: ticker.lastPrice, 
          change24h: ticker.changePercent24h,
          timestamp: nowStr 
        });
        return reply.send({ success: false, message: 'Insufficient BRL balance to buy.' });
      }
      
      const op = await ordersService.createBuyOrder(symbol, amount);
      
      // Atualizar tracking de preços após compra bem-sucedida
      if (op.status === 'success') {
        await priceTrackingService.updatePriceTracking(symbol);
        // Atualizar lastBuyPrice no JobConfig
        await JobConfig.updateOne(
          { symbol },
          { $set: { lastBuyPrice: Number(currentPrice.toFixed(8)), updatedAt: new Date() } }
        );
      }
      
      if (op.status === 'success') {
        logJobMetric('buy_amount', symbol, amount);
        logJobMetric('buy_value_brl', symbol, amount);
      }
      
      console.log(`[JOB] Executed | Symbol: ${symbol} | Action: BUY | Value: R$${amount} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Strategy: ${symbolConfig.sellStrategy} | BuyThreshold: ${symbolConfig.buyThreshold} | SellThreshold: ${symbolConfig.sellThreshold} | Date: ${nowStr}`);
      return reply.send({ success: op.status === 'success', message: 'Buy order executed', op, priceCheck });
    } 
    if(action == 'sell') {
      // Get base currency balance
      const baseCurrency = symbol.split('_')[0];
      const balance = await balanceService.getBalance(baseCurrency);
      const amount = parseFloat(balance.available);
      
      if (amount <= 0) {
        const reason = 'insufficient balance to sell';
        console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Reason: ${reason} | Date: ${nowStr}`);
        logJobEvent('failed', symbol, { 
          reason, 
          availableBalance: amount,
          baseCurrency,
          price: ticker.lastPrice, 
          change24h: ticker.changePercent24h,
          timestamp: nowStr 
        });
        return reply.send({ success: false, message: 'Insufficient balance to sell.' });
      }

      const currentPrice = parseFloat(ticker.lastPrice);
      
      // NOVO: Só permite vender se buyThreshold for positivo
      if (typeof symbolConfig.sellThreshold !== 'number' || symbolConfig.sellThreshold <= 0) {
        return reply.send({
          success: false,
          message: `Sell not allowed: buyThreshold must be positive (current: ${symbolConfig.buyThreshold})`
        });
      }
      // Só permite vender se o preço atual for maior que lastBuyPrice + buyThreshold%
      if (symbolConfig.lastBuyPrice) {
        const sellLimit = symbolConfig.lastBuyPrice * (1 + (symbolConfig.buyThreshold / 100));
        if (currentPrice <= sellLimit) {
          return reply.send({
            success: false,
            message: `Sell skipped: current price (${currentPrice}) is not greater than lastBuyPrice (${symbolConfig.lastBuyPrice}) + buyThreshold (${symbolConfig.buyThreshold}%) = ${sellLimit}`
          });
        }
      }

      // Obter configuração da estratégia para este símbolo
      const strategyConfig = getStrategyConfig(symbolConfig);
      
      // Enhanced partial sale logic with multiple exit levels
      let tracker = partialSales.get(symbol);
      
      if (!tracker) {
        // Verificar se o preço atual é adequado para venda
        const priceCheck = await priceTrackingService.shouldSellAtPrice(symbol, currentPrice);
        if (!priceCheck.shouldSell) {
          const reason = `price check failed: ${priceCheck.reason}`;
          console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${currentPrice} | 24h change: ${ticker.changePercent24h}% | Reason: ${reason} | Date: ${nowStr}`);
          logJobEvent('sell_skipped', symbol, { 
            reason, 
            currentPrice,
            priceCheck,
            change24h: ticker.changePercent24h,
            strategy: symbolConfig.sellStrategy,
            timestamp: nowStr 
          });
          return reply.send({ 
            success: false, 
            message: `Sell skipped: ${priceCheck.reason}`,
            priceCheck
          });
        }
        
        // Primeira venda: vender conforme a estratégia configurada
        const firstSellAmount = Math.floor(amount * strategyConfig.levels[0].percentage);
        if (firstSellAmount <= 0) {
          const reason = 'calculated sell amount is zero after flooring';
          logJobEvent('sell_first_failed', symbol, { reason, amount, percentage: strategyConfig.levels[0].percentage });
          return reply.send({ success: false, message: 'Sell amount is zero, cannot execute order.' });
        }
        const op = await ordersService.createSellOrder(symbol, firstSellAmount);
        
        if (op.status === 'success') {
          tracker = new PartialSaleTracker(symbol, amount, currentPrice, strategyConfig);
          partialSales.set(symbol, tracker);
          // Atualizar tracking de preços após venda bem-sucedida
          await priceTrackingService.updatePriceTracking(symbol);
          // Atualizar lastSellPrice no JobConfig
          await JobConfig.updateOne(
            { symbol },
            { $set: { lastSellPrice: Number(currentPrice.toFixed(8)), updatedAt: new Date() } }
          );
          // Log first sell execution
          logJobEvent('sell_first_executed', symbol, { 
            amount: firstSellAmount, 
            percentage: strategyConfig.levels[0].percentage * 100,
            price: currentPrice, 
            change24h: ticker.changePercent24h,
            orderStatus: op.status,
            orderId: op.id,
            strategy: symbolConfig.sellStrategy,
            strategyName: strategyConfig.name,
            priceCheck,
            timestamp: nowStr 
          });
          
          logJobMetric('sell_amount', symbol, firstSellAmount);
          logJobMetric('sell_value_brl', symbol, firstSellAmount * currentPrice);
          
          console.log(`[JOB] Executed | Symbol: ${symbol} | Action: SELL ${(strategyConfig.levels[0].percentage * 100).toFixed(0)}% | Amount: ${firstSellAmount} | Price: ${currentPrice} | Strategy: ${symbolConfig.sellStrategy} | BuyThreshold: ${symbolConfig.buyThreshold} | SellThreshold: ${symbolConfig.sellThreshold} | 24h change: ${ticker.changePercent24h}% | Date: ${nowStr}`);
          
          // Log remaining targets if any
          const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
          if (remainingTargets.length > 0) {
            console.log(`[JOB] Strategy | Next targets: ${remainingTargets.map(l => `+${((l.price/tracker.firstSellPrice-1)*100).toFixed(1)}%`).join(', ')} | Trailing stop: ${tracker.trailingStop}`);
          }
          
          return reply.send({ 
            success: true, 
            message: `Sell order (${(strategyConfig.levels[0].percentage * 100).toFixed(0)}%) executed - ${strategyConfig.name} strategy activated`, 
            op,
            priceCheck,
            strategy: {
              type: symbolConfig.sellStrategy,
              name: strategyConfig.name,
              nextTargets: remainingTargets.map(l => ({ percentage: l.percentage * 100, price: l.price })),
              trailingStop: tracker.trailingStop
            }
          });
        } else {
          logJobEvent('sell_first_failed', symbol, { 
            amount: firstSellAmount, 
            price: currentPrice, 
            orderStatus: op.status,
            orderError: op.error,
            strategy: symbolConfig.sellStrategy,
            timestamp: nowStr 
          });
          return reply.send({ success: false, message: `Sell order (${(strategyConfig.levels[0].percentage * 100).toFixed(0)}%) failed`, op });
        }
      } else {
        // Update tracker with current price
        tracker.updateHighestPrice(currentPrice);
        
        // Check if we should sell based on strategy
        const sellDecision = tracker.shouldSell(currentPrice);
        
        if (sellDecision.shouldSell) {
          // NovaDAX requires a minimum sale of R$50 (or configured value)
          const minSellValueBRL = strategyConfig.minSellValueBRL;
          const sellValueBRL = sellDecision.amount * currentPrice;
          if (sellValueBRL < minSellValueBRL) {
            const reason = 'sale value below minimum';
            console.log(`[JOB] Sale NOT executed | Symbol: ${symbol} | Reason: sale value (R$${sellValueBRL.toFixed(2)}) is less than the minimum of R$${minSellValueBRL}`);
            logJobEvent('sell_skipped', symbol, { 
              reason, 
              attemptedValue: sellValueBRL,
              minRequired: minSellValueBRL,
              amount: sellDecision.amount,
              price: currentPrice,
              strategy: symbolConfig.sellStrategy,
              timestamp: nowStr 
            });
            return reply.send({
              success: false,
              message: `Sale not executed: sale value (R$${sellValueBRL.toFixed(2)}) is less than the minimum of R$${minSellValueBRL}`,
              strategy: {
                type: symbolConfig.sellStrategy,
                requiredMinValue: minSellValueBRL,
                attemptedValue: sellValueBRL,
                attemptedAmount: sellDecision.amount,
                currentPrice
              }
            });
          }
          const sellAmount = Math.floor(sellDecision.amount);
          if (sellAmount <= 0) {
            const reason = 'calculated sell amount is zero after flooring';
            logJobEvent('sell_strategy_failed', symbol, { reason, amount: sellDecision.amount });
            return reply.send({ success: false, message: 'Sell amount is zero, cannot execute order' });
          }
          const op = await ordersService.createSellOrder(symbol, sellAmount);
          
          if (op.status === 'success') {
            tracker.markLevelExecuted(sellDecision.level);
            
            // Log strategy sell execution
            logJobEvent('sell_strategy_executed', symbol, { 
              amount: sellDecision.amount, 
              percentage: sellDecision.level.percentage * 100,
              price: currentPrice, 
              reason: sellDecision.reason,
              orderStatus: op.status,
              orderId: op.id,
              strategy: symbolConfig.sellStrategy,
              strategyName: strategyConfig.name,
              byValue: symbolConfig.byValue,
              timestamp: nowStr 
            });
            
            logJobMetric('sell_amount', symbol, sellDecision.amount);
            logJobMetric('sell_value_brl', symbol, sellValueBRL);
            
            const strategyInfo = symbolConfig.byValue ? `Value-based (${symbolConfig.valueSellThreshold}%)` : symbolConfig.sellStrategy;
            console.log(`[JOB] Executed | Symbol: ${symbol} | Action: SELL ${(sellDecision.level.percentage * 100).toFixed(0)}% | Amount: ${sellDecision.amount} | Price: ${currentPrice} | Strategy: ${strategyInfo} | BuyThreshold: ${symbolConfig.buyThreshold} | SellThreshold: ${symbolConfig.sellThreshold} | Reason: ${sellDecision.reason} | Date: ${nowStr}`);
            
            // Check if strategy is complete
            if (tracker.isComplete()) {
              partialSales.delete(symbol);
              
              // Calculate final profit metrics
              const metrics = tracker.getProfitMetrics();
              
              // Log strategy completion
              logJobEvent('strategy_complete', symbol, { 
                avgSellPrice: metrics.avgSellPrice,
                profitPercent: metrics.profitPercent,
                maxProfitPercent: metrics.maxProfitPercent,
                highestPrice: metrics.highestPrice,
                strategy: symbolConfig.sellStrategy,
                strategyName: strategyConfig.name,
                byValue: symbolConfig.byValue,
                timestamp: nowStr 
              });
              
              logJobMetric('strategy_profit_percent', symbol, parseFloat(metrics.profitPercent));
              logJobMetric('strategy_max_profit_percent', symbol, parseFloat(metrics.maxProfitPercent));
              
              console.log(`[JOB] Strategy Complete | Symbol: ${symbol} | Strategy: ${strategyInfo} | All levels executed | Total profit strategy finished`);
              if (symbolConfig.byValue) {
                console.log(`[JOB] Performance | Initial Value: R$${metrics.initialValueBRL?.toFixed(2)} | Final Value: R$${metrics.currentValueBRL?.toFixed(2)} | Profit: +${metrics.profitPercent}% | Highest Value: R$${metrics.highestValueBRL?.toFixed(2)}`);
              } else {
                console.log(`[JOB] Performance | Avg Sell Price: ${metrics.avgSellPrice} | Profit: +${metrics.profitPercent}% | Max Profit: +${metrics.maxProfitPercent}% | Highest Price: ${metrics.highestPrice}`);
              }
              
              return reply.send({ 
                success: true, 
                message: `Sell order executed - Strategy complete: ${sellDecision.reason}`, 
                op,
                strategy: { 
                  type: symbolConfig.sellStrategy,
                  name: strategyConfig.name,
                  status: 'complete', 
                  totalExecuted: true,
                  byValue: symbolConfig.byValue,
                  performance: metrics
                }
              });
            } else {
              // Log remaining targets (apenas para estratégias não baseadas em valor)
              if (!symbolConfig.byValue) {
                const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
                console.log(`[JOB] Strategy Update | Symbol: ${symbol} | Strategy: ${strategyInfo} | Remaining targets: ${remainingTargets.map(l => `+${((l.price/tracker.firstSellPrice-1)*100).toFixed(1)}%`).join(', ')} | Trailing stop: ${tracker.trailingStop}`);
              }
              
              return reply.send({ 
                success: true, 
                message: `Sell order executed: ${sellDecision.reason}`, 
                op,
                strategy: {
                  type: symbolConfig.sellStrategy,
                  name: strategyConfig.name,
                  byValue: symbolConfig.byValue,
                  remainingTargets: symbolConfig.byValue ? [] : tracker.sellLevels.filter(l => !l.executed).map(l => ({ percentage: l.percentage * 100, price: l.price })),
                  trailingStop: tracker.trailingStop,
                  highestPrice: tracker.highestPrice
                }
              });
            }
          } else {
            logJobEvent('sell_strategy_failed', symbol, { 
              amount: sellDecision.amount, 
              price: currentPrice, 
              reason: sellDecision.reason,
              orderStatus: op.status,
              orderError: op.error,
              strategy: symbolConfig.sellStrategy,
              timestamp: nowStr 
            });
            return reply.send({ success: false, message: `Sell order failed: ${sellDecision.reason}`, op });
          }
        } else {
          // No sell condition met - log current status
          if (symbolConfig.byValue) {
            // Para estratégia baseada em valor
            const metrics = tracker.getProfitMetrics();
            const valueIncreasePercent = ((metrics.currentValueBRL - metrics.initialValueBRL) / metrics.initialValueBRL * 100).toFixed(2);
            
            // Log strategy monitoring
            logJobEvent('strategy_monitoring', symbol, { 
              currentPrice,
              currentValueBRL: metrics.currentValueBRL,
              valueIncreasePercent: parseFloat(valueIncreasePercent),
              strategy: symbolConfig.sellStrategy,
              byValue: true,
              timestamp: nowStr 
            });
            
            console.log(`[JOB] Value Strategy Monitor | Symbol: ${symbol} | Strategy: ${symbolConfig.sellStrategy} | Current: ${currentPrice} | Value: R$${metrics.currentValueBRL?.toFixed(2)} | Profit: +${valueIncreasePercent}% | Waiting for +${symbolConfig.valueSellThreshold}% | Date: ${nowStr}`);
            
            return reply.send({ 
              success: false, 
              message: 'Value-based strategy active - waiting for value target',
              strategy: {
                type: symbolConfig.sellStrategy,
                name: strategyConfig.name,
                byValue: true,
                currentPrice,
                currentValueBRL: metrics.currentValueBRL?.toFixed(2),
                valueIncreasePercent: `${valueIncreasePercent}%`,
                targetThreshold: `${symbolConfig.valueSellThreshold}%`
              }
            });
          } else {
            // Para estratégias baseadas em preço (lógica original)
            const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
            const profitPotential = ((tracker.highestPrice / tracker.firstSellPrice - 1) * 100).toFixed(2);
            
            // Log strategy monitoring
            logJobEvent('strategy_monitoring', symbol, { 
              currentPrice,
              highestPrice: tracker.highestPrice,
              profitPotential: parseFloat(profitPotential),
              remainingTargets: remainingTargets.length,
              trailingStop: tracker.trailingStop,
              strategy: symbolConfig.sellStrategy,
              timestamp: nowStr 
            });
            
            console.log(`[JOB] Strategy Monitor | Symbol: ${symbol} | Strategy: ${symbolConfig.sellStrategy} | Current: ${currentPrice} | Highest: ${tracker.highestPrice} | Profit: +${profitPotential}% | Waiting for targets: ${remainingTargets.map(l => `+${((l.price/tracker.firstSellPrice-1)*100).toFixed(1)}%`).join(', ')} | Stop: ${tracker.trailingStop} | Date: ${nowStr}`);
            
            return reply.send({ 
              success: false, 
              message: 'Strategy active - waiting for price targets or trailing stop',
              strategy: {
                type: symbolConfig.sellStrategy,
                name: strategyConfig.name,
                currentPrice,
                highestPrice: tracker.highestPrice,
                profitPotential: `${profitPotential}%`,
                remainingTargets: remainingTargets.map(l => ({ percentage: l.percentage * 100, price: l.price })),
                trailingStop: tracker.trailingStop
              }
            });
          }
        }
      }
    }

  } catch (err) {
    console.error(`[JOB] Error: ${err.message}`);
    logJobError(symbol, err, { timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ') });
    return reply.status(500).send({ error: err.message });
  }
}

async function jobConfigHandler(request, reply) {
  try {
    console.log('[JOB CONFIG] Processing configuration update');
    console.log('[JOB CONFIG] Request body:', JSON.stringify(request.body, null, 2));
    
    // Se tem symbol no body, retornar apenas a configuração específica
    if (request.body.symbol) {
      console.log('[JOB CONFIG] Processing symbol-specific config for:', request.body.symbol);
      
    const config = await jobService.updateConfig(request.body);
      console.log('[JOB CONFIG] Full config returned:', JSON.stringify(config, null, 2));
      
      // Update cron schedule if available
      if (request.server.updateCronSchedule) {
        await request.server.updateCronSchedule();
      }
      
      // Buscar apenas a configuração do símbolo específico
      const symbolConfig = config.symbols.find(s => s.symbol === request.body.symbol);
      console.log('[JOB CONFIG] Found symbol config:', JSON.stringify(symbolConfig, null, 2));
      
      if (!symbolConfig) {
        console.error('[JOB CONFIG] Symbol config not found in response');
        return reply.status(404).send({ error: 'Symbol configuration not found after update' });
      }
      
      // Log configuration update
      logJobEvent('config_update', request.body.symbol, {
        buyThreshold: symbolConfig.buyThreshold,
        sellThreshold: symbolConfig.sellThreshold,
        enabled: symbolConfig.enabled,
        checkInterval: symbolConfig.checkInterval,
        sellStrategy: symbolConfig.sellStrategy,
        monitoringEnabled: symbolConfig.monitoringEnabled
      });

      return reply.send(symbolConfig);
    } else {
      // Se não tem symbol, é atualização global - retornar configuração completa
      console.log('[JOB CONFIG] Processing global config update');
      
      const config = await jobService.updateConfig(request.body);
    
    // Update cron schedule if available
    if (request.server.updateCronSchedule) {
      await request.server.updateCronSchedule();
    }
    
    // Log configuration update
    logJobEvent('config_update', 'system', {
      enabled: config.enabled,
      cooldownMinutes: config.cooldownMinutes || 30,
      totalSymbols: config.symbols.length,
      enabledSymbols: config.symbols.filter(s => s.enabled).length,
      disabledSymbols: config.symbols.filter(s => !s.enabled).length
    });

    return reply.send(config);
    }
  } catch (err) {
    console.error(`[JOB CONFIG] Error: ${err.message}`);
    logJobError('system', err, { context: 'jobConfigHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

async function jobAddSymbolHandler(request, reply) {
  try {
    const config = await jobService.addSymbol(request.body);
    return reply.send(config);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

async function jobRemoveSymbolHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const config = await jobService.removeSymbol(symbol);
    return reply.send(config);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

async function jobUpdateSymbolHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const config = await jobService.updateSymbol(symbol, request.body);
    return reply.send(config);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

async function jobGetSymbolHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const symbolConfig = await jobService.getSymbol(symbol);
    return reply.send(symbolConfig);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

async function jobStatusDetailedHandler(request, reply) {
  try {
    const config = await jobService.status();
    
    // Log configuration status
    logJobEvent('config_status', 'system', {
      totalSymbols: config.symbols.length,
      enabledSymbols: config.symbols.filter(s => s.enabled).length,
      disabledSymbols: config.symbols.filter(s => !s.enabled).length,
      cooldownMinutes: config.cooldownMinutes || 30
    });
    
    // Calcular próximo horário de execução baseado no cron
    const getNextExecutionTime = (cronExpression) => {
      try {
        // Usar node-cron para calcular próxima execução
        const parser = require('node-cron').parseExpression;
        const cronParser = parser(cronExpression);
        const nextDate = cronParser.next();
        return nextDate.toDate();
      } catch (err) {
        return null;
      }
    };

    // Calcular intervalo legível
    const getReadableInterval = (cronExpression) => {
      if (/^\*\/(\d+) \* \* \* \*$/.test(cronExpression)) {
        const min = parseInt(cronExpression.match(/^\*\/(\d+) \* \* \* \*$/)[1]);
        return `${min} minutos`;
      } else if (/^0 \*\/(\d+) \* \* \*$/.test(cronExpression)) {
        const hr = parseInt(cronExpression.match(/^0 \*\/(\d+) \* \* \*$/)[1]);
        return `${hr} horas`;
      } else if (/^0 0 \* \* \*$/.test(cronExpression)) {
        return '24 horas';
      } else if (/^0 \* \* \* \*$/.test(cronExpression)) {
        return '1 hora';
      }
      return cronExpression;
    };

    // Calcular última execução (se disponível)
    const getLastExecutionTime = (symbol) => {
      const lastExec = lastExecutions.get(symbol);
      return lastExec ? new Date(lastExec) : null;
    };

    // Calcular tempo até próxima execução
    const getTimeUntilNext = (nextExecution) => {
      if (!nextExecution) return null;
      const now = new Date();
      const diff = nextExecution.getTime() - now.getTime();
      const minutes = Math.floor(diff / (1000 * 60));
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      
      if (hours > 0) {
        return `${hours}h ${remainingMinutes}min`;
      }
      return `${minutes}min`;
    };

    // Enriquecer informações dos símbolos
    const enrichedSymbols = config.symbols.map(symbol => {
      const lastExec = getLastExecutionTime(symbol.symbol);
      
      // Calcular próxima execução individual para cada símbolo
      const symbolNextExecution = getNextExecutionTime(symbol.checkInterval);
      const symbolTimeUntilNext = getTimeUntilNext(symbolNextExecution);
      const symbolReadableInterval = getReadableInterval(symbol.checkInterval);

      // Obter informações da estratégia
      const strategyConfig = getStrategyConfig(symbol);

      return {
        ...symbol,
        lastExecution: lastExec ? lastExec.toISOString() : null,
        cooldownMinutes: config.cooldownMinutes || 30,
        nextExecution: symbolNextExecution ? symbolNextExecution.toISOString() : null,
        timeUntilNext: symbolTimeUntilNext,
        readableInterval: symbolReadableInterval,
        strategyInfo: {
          type: symbol.sellStrategy || 'security',
          name: strategyConfig.name,
          description: strategyConfig.description
        },
        status: symbol.enabled ? 
          'ready' : 
          'disabled'
      };
    });

    const response = {
      enabled: config.enabled,
      cooldownMinutes: config.cooldownMinutes || 30,
      symbols: enrichedSymbols,
      summary: {
        totalSymbols: config.symbols.length,
        enabledSymbols: config.symbols.filter(s => s.enabled).length,
        disabledSymbols: config.symbols.filter(s => !s.enabled).length,
        readySymbols: enrichedSymbols.filter(s => s.status === 'ready').length,
        cooldownSymbols: enrichedSymbols.filter(s => s.status === 'cooldown').length
      }
    };

    return reply.send(response);
  } catch (err) {
    logJobError('system', err, { context: 'jobStatusDetailedHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

async function jobUpdateIntervalHandler(request, reply) {
  try {
    const { checkInterval } = request.body;
    // Validate cron format
    if (!cron.validate(checkInterval)) {
      return reply.status(400).send({ error: 'Invalid interval format. Use cron format (ex: */5 * * * *)' });
    }
    // Update configuration
    const config = await jobService.updateConfig({
      checkInterval
    });
    // Update cron schedule if available
    if (request.server.updateCronSchedule) {
      await request.server.updateCronSchedule();
    }
    return reply.send(config);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

async function jobStrategyStatusHandler(request, reply) {
  try {
    const strategies = [];
    for (const [symbol, tracker] of partialSales.entries()) {
      const metrics = tracker.getProfitMetrics();
      const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
      
      // Obter configuração da estratégia
      const config = await jobService.status();
      const symbolConfig = config.symbols.find(s => s.symbol === symbol);
      const strategyConfig = getStrategyConfig(symbolConfig || { sellStrategy: 'security' });
      
      strategies.push({
        symbol,
        strategy: symbolConfig?.sellStrategy || 'security',
        strategyName: strategyConfig.name,
        initialAmount: tracker.initialAmount,
        remainingAmount: tracker.remainingAmount,
        firstSellPrice: tracker.firstSellPrice,
        currentHighestPrice: tracker.highestPrice,
        trailingStop: tracker.trailingStop,
        profitMetrics: metrics,
        remainingTargets: remainingTargets.map(l => ({
          percentage: l.percentage * 100,
          price: l.price,
          priceIncrease: ((l.price / tracker.firstSellPrice - 1) * 100).toFixed(1) + '%'
        })),
        lastUpdate: new Date(tracker.lastUpdate).toISOString(),
        age: ((Date.now() - tracker.lastUpdate) / (60 * 60 * 1000)).toFixed(1) + 'h'
      });
    }
    return reply.send({
      activeStrategies: strategies.length,
      strategies,
      summary: {
        totalActive: strategies.length,
        avgProfitPotential: strategies.length > 0 ? 
          (strategies.reduce((sum, s) => sum + parseFloat(s.profitMetrics.maxProfitPercent), 0) / strategies.length).toFixed(2) + '%' : '0%'
      }
    });
  } catch (err) {
    logJobError('system', err, { context: 'jobStrategyStatusHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

// Endpoint to get total profit/loss
async function getProfitSummaryHandler(request, reply) {
  try {
    // Get all successful sell operations with profit
    const sells = await Operation.find({ 
      type: 'sell', 
      status: 'success', 
      profit: { $exists: true } 
    });
    
    // Calculate totals
    let totalProfit = 0;
    const bySymbol = {};
    
    for (const op of sells) {
      totalProfit += op.profit || 0;
      if (!bySymbol[op.symbol]) bySymbol[op.symbol] = 0;
      bySymbol[op.symbol] += op.profit || 0;
    }
    
    // Log profit summary
    logJobEvent('profit_summary', 'system', {
      totalProfit: totalProfit.toFixed(2),
      operationsCount: sells.length,
      symbolsCount: Object.keys(bySymbol).length,
      avgProfitPerOperation: sells.length > 0 ? (totalProfit / sells.length).toFixed(2) : 0
    });
    
    // Log metrics
    logJobMetric('total_profit', 'system', totalProfit);
    logJobMetric('operations_count', 'system', sells.length);
    
    return reply.send({
      totalProfit: totalProfit.toFixed(2),
      bySymbol: Object.fromEntries(
        Object.entries(bySymbol).map(([k, v]) => [k, v.toFixed(2)])
      ),
      totalGain: totalProfit > 0 ? totalProfit.toFixed(2) : "0.00",
      totalLoss: totalProfit < 0 ? totalProfit.toFixed(2) : "0.00",
      operationsCount: sells.length
    });
  } catch (err) {
    logJobError('system', err, { context: 'getProfitSummaryHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

// Endpoint to get monitoring status
async function getMonitoringStatusHandler(request, reply) {
  try {
    // [REMOVER] buyMonitoringState, sellMonitoringState, BuyMonitoringTracker, SellMonitoringTracker, getMonitoringStatusHandler, stopMonitoringHandler, e qualquer uso relacionado
    return reply.send({ message: 'Sem monitoramento ativo no momento.' });
  } catch (err) {
    logJobError('system', err, { context: 'getMonitoringStatusHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

async function getPriceStatsHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const stats = await priceTrackingService.getPriceStats(symbol);
    
    if (!stats.success) {
      return reply.status(404).send({ error: stats.reason || 'Symbol not found' });
    }
    
    return reply.send(stats);
  } catch (err) {
    logJobError(request.params.symbol, err, { context: 'getPriceStatsHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

async function resetPriceTrackingHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const result = await priceTrackingService.resetPriceTracking(symbol);
    
    if (!result.success) {
      return reply.status(404).send({ error: result.reason || 'Symbol not found' });
    }
    
    // Log reset event
    logJobEvent('price_tracking_reset', symbol, {
      timestamp: new Date().toISOString()
    });
    
    return reply.send(result);
  } catch (err) {
    logJobError(request.params.symbol, err, { context: 'resetPriceTrackingHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

// Handler for /job/status: returns array of { symbol, status }
async function jobStatusHandler(request, reply) {
  try {
    const config = await jobService.status();
    // config.symbols is expected to be an array of symbol configs
    const result = config.symbols.map(s => ({
      symbol: s.symbol,
      status: !!s.enabled
    }));
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

// Handler for /job/toggle/:symbol: toggles enabled status for a symbol
async function jobToggleHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const config = await jobService.toggleSymbol(symbol);
    return reply.send(config);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

// Handler for /job/strategies: returns all strategies with description and rule
async function getAllStrategiesHandler(request, reply) {
  try {
    const strategies = Object.entries(sellStrategies).map(([type, strategy]) => {
      // Build a detailed rule description
      let ruleDescription = '';
      if (strategy.levels && Array.isArray(strategy.levels)) {
        ruleDescription += `Venda em ${strategy.levels.length} etapas: `;
        ruleDescription += strategy.levels.map((level, idx) => {
          const pct = (level.percentage * 100).toFixed(0) + '%';
          const inc = (level.priceIncrease * 100).toFixed(1) + '%';
          return `${pct} a partir de +${inc}`;
        }).join(', ') + '. ';
      }
      if (strategy.trailingStop) {
        ruleDescription += `Stop móvel: se o preço cair ${
          (strategy.trailingStop * 100).toFixed(1)
        }% do topo, vende o restante. `;
      }
      if (strategy.minSellValueBRL) {
        ruleDescription += `Venda mínima: R$${strategy.minSellValueBRL}.`;
      }
      return {
        type,
        name: strategy.name,
        description: strategy.description,
        rule: {
          levels: strategy.levels,
          trailingStop: strategy.trailingStop,
          minSellValueBRL: strategy.minSellValueBRL
        },
        ruleDescription
      };
    });
    return reply.send(strategies);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

// Handler para parar o monitoring ativo de um símbolo
async function stopMonitoringHandler(request, reply) {
  // [REMOVER] buyMonitoringState, sellMonitoringState, BuyMonitoringTracker, SellMonitoringTracker, getMonitoringStatusHandler, stopMonitoringHandler, e qualquer uso relacionado
  return reply.send({ success: false, message: 'Monitoring status is not tracked.' });
}


module.exports = {
  jobRunHandler,
  jobConfigHandler,
  jobAddSymbolHandler,
  jobRemoveSymbolHandler,
  jobUpdateSymbolHandler,
  jobGetSymbolHandler,
  jobStatusDetailedHandler,
  jobUpdateIntervalHandler,
  jobStrategyStatusHandler,
  getProfitSummaryHandler,
  getMonitoringStatusHandler,
  getPriceStatsHandler,
  resetPriceTrackingHandler,
  jobStatusHandler,
  jobToggleHandler,
  getAllStrategiesHandler,
  stopMonitoringHandler,
}; 