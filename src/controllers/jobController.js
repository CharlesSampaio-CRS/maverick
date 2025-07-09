const newrelic = require('newrelic');
const jobService = require('../services/jobService');
const tickerService = require('../services/tickerService');
const balanceService = require('../services/balanceService');
const ordersService = require('../services/ordersService');
const priceTrackingService = require('../services/priceTrackingService');
const Operation = require('../models/Operation');
const cron = require('node-cron');

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
// In-memory storage for monitoring state when thresholds are reached
const buyMonitoringState = new Map();
const sellMonitoringState = new Map();

// Estratégias de venda parametrizadas por tipo
const sellStrategies = {
  security: {
    name: 'Security',
    description: 'Estratégia conservadora - vende 30% inicial e progressivo',
    levels: [
      { percentage: 0.3, priceIncrease: 0 },    // 30% no primeiro nível
      { percentage: 0.3, priceIncrease: 0.05 }, // 30% em +5%
      { percentage: 0.2, priceIncrease: 0.10 }, // 20% em +10%
      { percentage: 0.2, priceIncrease: 0.15 }  // 20% em +15%
    ],
    trailingStop: 0.05, // 5% abaixo do preço mais alto
    minSellValueBRL: 50 // mínimo R$50 por venda
  },
  basic: {
    name: 'Basic',
    description: 'Estratégia básica - vende 40% inicial e progressivo',
    levels: [
      { percentage: 0.4, priceIncrease: 0 },    // 40% no primeiro nível
      { percentage: 0.3, priceIncrease: 0.05 }, // 30% em +5%
      { percentage: 0.3, priceIncrease: 0.10 }  // 30% em +10%
    ],
    trailingStop: 0.05, // 5% abaixo do preço mais alto
    minSellValueBRL: 50 // mínimo R$50 por venda
  },
  aggressive: {
    name: 'Aggressive',
    description: 'Estratégia agressiva - vende 100% imediatamente',
    levels: [
      { percentage: 1.0, priceIncrease: 0 }     // 100% imediatamente
    ],
    trailingStop: 0.02, // 2% abaixo do preço mais alto (mais agressivo)
    minSellValueBRL: 50 // mínimo R$50 por venda
  }
};

// Configuração padrão de monitoring
const defaultMonitoringConfig = {
  monitorMinutes: 60,
  buyOnRisePercent: 2.5,
  sellOnDropPercent: 2.5
};

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
  for (const [symbol, monitoring] of buyMonitoringState.entries()) {
    const timeElapsed = (now - monitoring.startTime) / (1000 * 60 * 60); // hours
    if (timeElapsed > 2) {
      console.log(`[JOB] Cleanup | Removing old buy monitoring for ${symbol} | Age: ${timeElapsed.toFixed(1)}h`);
      
      // Log cleanup event
      logJobEvent('buy_monitoring_cleanup', symbol, {
        age: timeElapsed.toFixed(1),
        initialPrice: monitoring.initialPrice,
        lowestPrice: monitoring.lowestPrice,
        reason: 'timeout'
      });
      
      buyMonitoringState.delete(symbol);
      cleanedCount++;
    }
  }
  
  // Cleanup old sell monitoring (older than 2 hours)
  for (const [symbol, monitoring] of sellMonitoringState.entries()) {
    const timeElapsed = (now - monitoring.startTime) / (1000 * 60 * 60); // hours
    if (timeElapsed > 2) {
      console.log(`[JOB] Cleanup | Removing old sell monitoring for ${symbol} | Age: ${timeElapsed.toFixed(1)}h`);
      
      // Log cleanup event
      logJobEvent('sell_monitoring_cleanup', symbol, {
        age: timeElapsed.toFixed(1),
        initialPrice: monitoring.initialPrice,
        highestPrice: monitoring.highestPrice,
        reason: 'timeout'
      });
      
      sellMonitoringState.delete(symbol);
      cleanedCount++;
    }
  }
  
  // Log cleanup summary
  if (cleanedCount > 0) {
    logJobEvent('cleanup_summary', 'system', {
      cleanedCount,
      remainingStrategies: partialSales.size,
      remainingBuyMonitoring: buyMonitoringState.size,
      remainingSellMonitoring: sellMonitoringState.size,
      timestamp: new Date().toISOString()
    });
  }
}

// Run cleanup every hour
setInterval(cleanupOldStrategies, 60 * 60 * 1000);

async function jobStatusHandler(request, reply) {
  try {
    const config = await jobService.status();
    // Return only symbol and status (enabled/disabled)
    const simpleStatus = config.symbols.map(symbol => ({
      symbol: symbol.symbol,
      status: symbol.enabled
    }));
    return reply.send(simpleStatus);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

async function jobToggleHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const config = await jobService.toggleSymbol(symbol);
    
    // Log symbol toggle
    const symbolConfig = config.symbols.find(s => s.symbol === symbol);
    logJobEvent('symbol_toggle', symbol, {
      enabled: symbolConfig.enabled,
      buyThreshold: symbolConfig.buyThreshold,
      sellThreshold: symbolConfig.sellThreshold,
      checkInterval: symbolConfig.checkInterval
    });
    
    return reply.send(config);
  } catch (err) {
    logJobError(request.params.symbol, err, { context: 'jobToggleHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

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

    // Check if symbol is in buy monitoring mode
    const buyMonitoring = buyMonitoringState.get(symbol);
    if (buyMonitoring) {
      // Update buy monitoring with current price
      buyMonitoring.updatePrice(parseFloat(ticker.lastPrice));
      
      // Check if we should buy based on monitoring
      const buyDecision = buyMonitoring.shouldBuy(parseFloat(ticker.lastPrice));
      
      if (buyDecision.shouldBuy) {
        // Remove from monitoring and proceed with buy
        buyMonitoringState.delete(symbol);
        
        // Log buy monitoring completion
        logJobEvent('buy_monitoring_complete', symbol, {
          reason: buyDecision.reason,
          initialPrice: buyMonitoring.initialPrice,
          lowestPrice: buyDecision.lowestPrice,
          finalPrice: buyDecision.price,
          timeElapsed: ((Date.now() - buyMonitoring.startTime) / (1000 * 60)).toFixed(1)
        });
        
        console.log(`[JOB] Buy Monitoring Complete | Symbol: ${symbol} | ${buyDecision.reason} | Initial: ${buyMonitoring.initialPrice} | Lowest: ${buyDecision.lowestPrice} | Final: ${buyDecision.price}`);
        
        // Proceed with buy action
        action = 'buy';
      } else {
        // Still monitoring - log status and return
        const status = buyMonitoring.getStatus();
        logJobEvent('buy_monitoring_active', symbol, status);
        
        console.log(`[JOB] Buy Monitoring Active | Symbol: ${symbol} | Current: ${ticker.lastPrice} | Lowest: ${buyMonitoring.lowestPrice} | Time: ${status.timeElapsed}min | Remaining: ${status.remainingTime}min`);
        
        return reply.send({
          success: false,
          message: `Buy monitoring active: ${buyDecision.reason || 'Waiting for optimal buy point'}`,
          buyMonitoring: status
        });
      }
    }

    // Check if symbol is in sell monitoring mode
    const sellMonitoring = sellMonitoringState.get(symbol);
    if (sellMonitoring) {
      // Update sell monitoring with current price
      sellMonitoring.updatePrice(parseFloat(ticker.lastPrice));
      
      // Check if we should sell based on monitoring
      const sellDecision = sellMonitoring.shouldSell(parseFloat(ticker.lastPrice));
      
      if (sellDecision.shouldSell) {
        // Remove from monitoring and proceed with sell
        sellMonitoringState.delete(symbol);
        
        // Log sell monitoring completion
        logJobEvent('sell_monitoring_complete', symbol, {
          reason: sellDecision.reason,
          initialPrice: sellMonitoring.initialPrice,
          highestPrice: sellDecision.highestPrice,
          finalPrice: sellDecision.price,
          timeElapsed: ((Date.now() - sellMonitoring.startTime) / (1000 * 60)).toFixed(1)
        });
        
        console.log(`[JOB] Sell Monitoring Complete | Symbol: ${symbol} | ${sellDecision.reason} | Initial: ${sellMonitoring.initialPrice} | Highest: ${sellDecision.highestPrice} | Final: ${sellDecision.price}`);
        
        // Proceed with sell action
        action = 'sell';
      } else {
        // Still monitoring - log status and return
        const status = sellMonitoring.getStatus();
        logJobEvent('sell_monitoring_active', symbol, status);
        
        console.log(`[JOB] Sell Monitoring Active | Symbol: ${symbol} | Current: ${ticker.lastPrice} | Highest: ${sellMonitoring.highestPrice} | Time: ${status.timeElapsed}min | Remaining: ${status.remainingTime}min`);
        
        return reply.send({
          success: false,
          message: `Sell monitoring active: ${sellDecision.reason || 'Waiting for optimal sell point'}`,
          sellMonitoring: status
        });
      }
    }

    // Normal threshold checking (only if not in monitoring mode)
    if (!action) {
      // Validação explícita dos thresholds
      if (change <= symbolConfig.buyThreshold) {
        if (change !== symbolConfig.buyThreshold && change > symbolConfig.buyThreshold) {
          return reply.send({ success: false, message: `Buy not executed: changePercent24h (${change}) is not <= buyThreshold (${symbolConfig.buyThreshold})` });
        }
        
        // Check if buy monitoring is enabled
        if (symbolConfig.monitoringEnabled) {
          // Start buy monitoring instead of buying immediately
          const buyMonitoringTracker = new BuyMonitoringTracker(
            symbol,
            parseFloat(ticker.lastPrice),
            symbolConfig.buyThreshold,
            defaultMonitoringConfig.monitorMinutes,
            defaultMonitoringConfig.buyOnRisePercent
          );
          
          buyMonitoringState.set(symbol, buyMonitoringTracker);
          
          // Log buy monitoring start
          logJobEvent('buy_monitoring_started', symbol, {
            initialPrice: parseFloat(ticker.lastPrice),
            buyThreshold: symbolConfig.buyThreshold,
            change24h: change
          });
          
          console.log(`[JOB] Buy Monitoring Started | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${change}% | Threshold: ${symbolConfig.buyThreshold}%`);
          
          return reply.send({
            success: false,
            message: `Buy threshold reached (${change}% <= ${symbolConfig.buyThreshold}%). Buy monitoring started for optimal buy point.`,
            buyMonitoring: buyMonitoringTracker.getStatus()
          });
        }
        
        action = 'buy';
      } else if (change >= symbolConfig.sellThreshold) {
        if (change !== symbolConfig.sellThreshold && change < symbolConfig.sellThreshold) {
          return reply.send({ success: false, message: `Sell not executed: changePercent24h (${change}) is not >= sellThreshold (${symbolConfig.sellThreshold})` });
        }
        
        // Check if sell monitoring is enabled for this strategy
        const strategyConfig = getStrategyConfig(symbolConfig);
        if (symbolConfig.monitoringEnabled) {
          // NOVO: Checar maxSellPrice antes de iniciar o monitoramento
          const priceStats = await priceTrackingService.getPriceStats(symbol);
          const maxSellPrice = priceStats.maxSellPrice;
          const currentPrice = parseFloat(ticker.lastPrice);
          if (!maxSellPrice || currentPrice < maxSellPrice) {
            return reply.send({
              success: false,
              message: `Sell not started: current price (${currentPrice}) has not reached the minimum sell price (${maxSellPrice}) yet.`
            });
          }
          // Start sell monitoring instead of selling immediately
          const sellMonitoringTracker = new SellMonitoringTracker(
            symbol,
            currentPrice,
            symbolConfig.sellThreshold,
            defaultMonitoringConfig.monitorMinutes,
            defaultMonitoringConfig.sellOnDropPercent
          );
          sellMonitoringState.set(symbol, sellMonitoringTracker);
          // Log sell monitoring start
          logJobEvent('sell_monitoring_started', symbol, {
            initialPrice: currentPrice,
            sellThreshold: symbolConfig.sellThreshold,
            change24h: change,
            strategy: symbolConfig.sellStrategy
          });
          console.log(`[JOB] Sell Monitoring Started | Symbol: ${symbol} | Price: ${currentPrice} | 24h change: ${change}% | Threshold: ${symbolConfig.sellThreshold}% | Strategy: ${symbolConfig.sellStrategy}`);
          return reply.send({
            success: false,
            message: `Sell threshold reached (${change}% >= ${symbolConfig.sellThreshold}%). Sell monitoring started for optimal sell point.`,
            sellMonitoring: sellMonitoringTracker.getStatus()
          });
        }
        
        action = 'sell';
      }
    }

    if (!action) {
      const reason = 'no buy/sell condition met';
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | ${reason} | BuyThreshold: ${symbolConfig.buyThreshold} | SellThreshold: ${symbolConfig.sellThreshold} | Date: ${nowStr}`);
      // Send to New Relic as a custom event (in English)
      logJobEvent('no_condition_met', symbol, {
        reason,
        price: ticker.lastPrice,
        change24h: ticker.changePercent24h,
        buyThreshold: symbolConfig.buyThreshold,
        sellThreshold: symbolConfig.sellThreshold,
        status: 'executed',
        startTime: request.startTime || nowStr,
        timestamp: nowStr
      });
      return reply.send({ success: false, message: 'No buy/sell condition met.' });
    }

    // Log action decision
    logJobEvent('action_decision', symbol, { 
      action, 
      price: ticker.lastPrice, 
      change24h: ticker.changePercent24h,
      buyThreshold: symbolConfig.buyThreshold,
      sellThreshold: symbolConfig.sellThreshold,
      timestamp: nowStr 
    });

    // 4. Execute order
    if (action === 'buy') {
      const currentPrice = parseFloat(ticker.lastPrice);
      
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
      
      if (amount < 10) {
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
      }
      
      // Log buy execution
      logJobEvent('buy_executed', symbol, { 
        amount, 
        price: ticker.lastPrice, 
        change24h: ticker.changePercent24h,
        orderStatus: op.status,
        orderId: op.id,
        priceCheck,
        timestamp: nowStr 
      });
      
      if (op.status === 'success') {
        logJobMetric('buy_amount', symbol, amount);
        logJobMetric('buy_value_brl', symbol, amount);
      }
      
      console.log(`[JOB] Executed | Symbol: ${symbol} | Action: BUY | Value: R$${amount} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Strategy: ${symbolConfig.sellStrategy} | BuyThreshold: ${symbolConfig.buyThreshold} | SellThreshold: ${symbolConfig.sellThreshold} | Date: ${nowStr}`);
      return reply.send({ success: op.status === 'success', message: 'Buy order executed', op, priceCheck });
    } else {
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
            return reply.send({ success: false, message: 'Sell amount is zero, cannot execute order.' });
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
              timestamp: nowStr 
            });
            
            logJobMetric('sell_amount', symbol, sellDecision.amount);
            logJobMetric('sell_value_brl', symbol, sellValueBRL);
            
            console.log(`[JOB] Executed | Symbol: ${symbol} | Action: SELL ${(sellDecision.level.percentage * 100).toFixed(0)}% | Amount: ${sellDecision.amount} | Price: ${currentPrice} | Strategy: ${symbolConfig.sellStrategy} | BuyThreshold: ${symbolConfig.buyThreshold} | SellThreshold: ${symbolConfig.sellThreshold} | Reason: ${sellDecision.reason} | Date: ${nowStr}`);
            
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
                timestamp: nowStr 
              });
              
              logJobMetric('strategy_profit_percent', symbol, parseFloat(metrics.profitPercent));
              logJobMetric('strategy_max_profit_percent', symbol, parseFloat(metrics.maxProfitPercent));
              
              console.log(`[JOB] Strategy Complete | Symbol: ${symbol} | Strategy: ${symbolConfig.sellStrategy} | All levels executed | Total profit strategy finished`);
              console.log(`[JOB] Performance | Avg Sell Price: ${metrics.avgSellPrice} | Profit: +${metrics.profitPercent}% | Max Profit: +${metrics.maxProfitPercent}% | Highest Price: ${metrics.highestPrice}`);
              
              return reply.send({ 
                success: true, 
                message: `Sell order executed - Strategy complete: ${sellDecision.reason}`, 
                op,
                strategy: { 
                  type: symbolConfig.sellStrategy,
                  name: strategyConfig.name,
                  status: 'complete', 
                  totalExecuted: true,
                  performance: metrics
                }
              });
            } else {
              // Log remaining targets
              const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
              console.log(`[JOB] Strategy Update | Symbol: ${symbol} | Strategy: ${symbolConfig.sellStrategy} | Remaining targets: ${remainingTargets.map(l => `+${((l.price/tracker.firstSellPrice-1)*100).toFixed(1)}%`).join(', ')} | Trailing stop: ${tracker.trailingStop}`);
              
              return reply.send({ 
                success: true, 
                message: `Sell order executed: ${sellDecision.reason}`, 
                op,
                strategy: {
                  type: symbolConfig.sellStrategy,
                  name: strategyConfig.name,
                  remainingTargets: remainingTargets.map(l => ({ percentage: l.percentage * 100, price: l.price })),
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

// Endpoint to get the sale strategy configuration
async function getSaleStrategyConfigHandler(request, reply) {
  return reply.send(sellStrategies);
}

// Endpoint to update the sale strategy configuration
async function updateSaleStrategyConfigHandler(request, reply) {
  try {
    const { strategyType, levels, trailingStop, minSellValueBRL } = request.body;
    const strategyConfig = sellStrategies[strategyType];

    if (!strategyConfig) {
      return reply.status(400).send({ error: `Strategy type "${strategyType}" not found.` });
    }

    if (levels) {
      // Basic validation of levels
      if (!Array.isArray(levels) || levels.length === 0) {
        return reply.status(400).send({ error: 'levels must be a non-empty array' });
      }
      let total = 0;
      for (const l of levels) {
        if (typeof l.percentage !== 'number' || typeof l.priceIncrease !== 'number') {
          return reply.status(400).send({ error: 'Each level must have numeric percentage and priceIncrease' });
        }
        total += l.percentage;
      }
      if (Math.abs(total - 1) > 0.01) {
        return reply.status(400).send({ error: 'The sum of percentages must be 1 (100%)' });
      }
      strategyConfig.levels = levels;
    }
    if (typeof trailingStop === 'number') {
      if (trailingStop < 0.01 || trailingStop > 0.5) {
        return reply.status(400).send({ error: 'trailingStop must be between 0.01 and 0.5 (1% to 50%)' });
      }
      strategyConfig.trailingStop = trailingStop;
    }
    if (typeof minSellValueBRL === 'number') {
      if (minSellValueBRL < 10) {
        return reply.status(400).send({ error: 'minSellValueBRL must be at least 10' });
      }
      strategyConfig.minSellValueBRL = minSellValueBRL;
    }
    return reply.send(sellStrategies);
  } catch (err) {
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
    const buyMonitoring = Array.from(buyMonitoringState.entries()).map(([symbol, monitoring]) => ({
      symbol,
      ...monitoring.getStatus()
    }));
    
    const sellMonitoring = Array.from(sellMonitoringState.entries()).map(([symbol, monitoring]) => ({
      symbol,
      ...monitoring.getStatus()
    }));
    
    return reply.send({
      buyMonitoring,
      sellMonitoring,
      summary: {
        activeBuyMonitoring: buyMonitoring.length,
        activeSellMonitoring: sellMonitoring.length
      }
    });
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

module.exports = {
  jobStatusHandler,
  jobToggleHandler,
  jobRunHandler,
  jobConfigHandler,
  jobAddSymbolHandler,
  jobRemoveSymbolHandler,
  jobUpdateSymbolHandler,
  jobGetSymbolHandler,
  jobStatusDetailedHandler,
  jobUpdateIntervalHandler,
  jobStrategyStatusHandler,
  getSaleStrategyConfigHandler,
  updateSaleStrategyConfigHandler,
  getProfitSummaryHandler,
  getMonitoringStatusHandler,
  getPriceStatsHandler,
  resetPriceTrackingHandler,
}; 