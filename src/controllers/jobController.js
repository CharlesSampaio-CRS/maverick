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

// ===== LOGGING FUNCTIONS =====
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

// ===== CONSOLE LOGGING FUNCTIONS =====
function logJobStart(symbol, nowStr) {
  console.log(`[MAVERICK] Job Started | Symbol: ${symbol} | Date: ${nowStr}`);
  logJobEvent('started', symbol, { timestamp: nowStr });
}

function logJobValidation(symbol, reason, nowStr, details = {}) {
  console.log(`[MAVERICK] Job Skipped | Symbol: ${symbol} | Reason: ${reason} | Date: ${nowStr}`);
  logJobEvent('skipped', symbol, { reason, timestamp: nowStr, ...details });
}

function logJobExecution(symbol, action, details, nowStr) {
  const actionUpper = action.toUpperCase();
  console.log(`[MAVERICK] Job Executed | Symbol: ${symbol} | Action: ${actionUpper} | ${Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(' | ')} | Date: ${nowStr}`);
  logJobEvent(`${action}_executed`, symbol, { action, ...details, timestamp: nowStr });
}

function logJobFailure(symbol, reason, nowStr, details = {}) {
  console.log(`[MAVERICK] Job Failed | Symbol: ${symbol} | Reason: ${reason} | Date: ${nowStr}`);
  logJobEvent('failed', symbol, { reason, timestamp: nowStr, ...details });
}

function logStrategyExecution(symbol, strategy, details, nowStr) {
  console.log(`[MAVERICK] Strategy Executed | Symbol: ${symbol} | Strategy: ${strategy} | ${Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(' | ')} | Date: ${nowStr}`);
  logJobEvent('strategy_executed', symbol, { strategy, ...details, timestamp: nowStr });
}

function logStrategyMonitoring(symbol, strategy, details, nowStr) {
  console.log(`[MAVERICK] Strategy Monitor | Symbol: ${symbol} | Strategy: ${strategy} | ${Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(' | ')} | Date: ${nowStr}`);
  logJobEvent('strategy_monitoring', symbol, { strategy, ...details, timestamp: nowStr });
}

function logStrategyComplete(symbol, strategy, performance, nowStr) {
  console.log(`[MAVERICK] Strategy Complete | Symbol: ${symbol} | Strategy: ${strategy} | Performance: ${Object.entries(performance).map(([k, v]) => `${k}: ${v}`).join(', ')} | Date: ${nowStr}`);
  logJobEvent('strategy_complete', symbol, { strategy, performance, timestamp: nowStr });
}

function logCleanup(symbol, age, details) {
  console.log(`[MAVERICK] Cleanup | Removing old strategy for ${symbol} | Age: ${age}h`);
  logJobEvent('strategy_cleanup', symbol, { age, ...details });
}

// ===== STORAGE =====
const lastExecutions = new Map();
const partialSales = new Map();

// ===== STRATEGY CONFIGURATION =====
function getStrategyConfig(symbolConfig) {
  const strategyType = symbolConfig.sellStrategy || 'security';
  return sellStrategies[strategyType] || sellStrategies.security;
}

// ===== PARTIAL SALE TRACKER =====
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
      executed: idx === 0
    }));
    this.remainingAmount -= initialAmount * this.sellLevels[0].percentage;
    this.trailingStop = firstSellPrice * (1 - strategyConfig.trailingStop);
    this.lastUpdate = Date.now();
  }

  updateHighestPrice(currentPrice) {
    if (currentPrice > this.highestPrice) {
      this.highestPrice = currentPrice;
      this.trailingStop = Math.max(this.trailingStop, currentPrice * 0.95);
    }
  }

  shouldSell(currentPrice) {
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

// ===== CLEANUP FUNCTION =====
function cleanupOldStrategies() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  let cleanedCount = 0;
  
  for (const [symbol, tracker] of partialSales.entries()) {
    if (now - tracker.lastUpdate > maxAge) {
      const age = ((now - tracker.lastUpdate) / (60 * 60 * 1000)).toFixed(1);
      logCleanup(symbol, age, {
        initialAmount: tracker.initialAmount,
        remainingAmount: tracker.remainingAmount,
        highestPrice: tracker.highestPrice,
        profitMetrics: tracker.getProfitMetrics()
      });
      
      partialSales.delete(symbol);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    logJobEvent('cleanup_summary', 'system', {
      cleanedCount,
      remainingStrategies: partialSales.size,
      timestamp: new Date().toISOString()
    });
  }
}

setInterval(cleanupOldStrategies, 60 * 60 * 1000);

// ===== MAIN JOB HANDLER =====
async function jobRunHandler(request, reply) {
  let symbol;
  try {
    ({ symbol } = request.body);
    const nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
    
    logJobStart(symbol, nowStr);
    
    if (!symbol) {
      logJobFailure(symbol, 'Symbol not provided', nowStr);
      return reply.status(400).send({ error: 'Symbol not provided' });
    }

    // 1. Get configuration and ticker data
    const [config, ticker] = await Promise.all([
      jobService.status(),
      tickerService.getTicker(symbol)
    ]);
    
    const symbolConfig = config.symbols.find(s => s.symbol === symbol);
    
    if (!symbolConfig || !symbolConfig.enabled) {
      logJobValidation(symbol, 'symbol disabled', nowStr);
      return reply.send({ success: false, message: 'Symbol is disabled' });
    }

    if (!ticker.success) {
      logJobFailure(symbol, 'error getting ticker', nowStr, { tickerError: ticker.error });
      return reply.send({ success: false, message: 'Error getting ticker data' });
    }

    // Log ticker data
    logJobMetric('price', symbol, parseFloat(ticker.lastPrice));
    logJobMetric('change24h', symbol, parseFloat(ticker.changePercent24h));

    // 2. Check thresholds and decide action
    const change = parseFloat(ticker.changePercent24h);
    let action = null;

    if (!action) {
      // Buy rule: if 24h change <= buyThreshold
      if (change <= symbolConfig.buyThreshold) {
        const balance = await balanceService.getBalance('BRL');
        const max = parseFloat(balance.available);
        if (max >= 25) {
          action = 'buy';
        } 
      } 
      // Sell rule: if 24h change >= sellThreshold
      if (change >= symbolConfig.sellThreshold) {
        const baseCurrency = symbol.split('_')[0];
        const balance = await balanceService.getBalance(baseCurrency);
        const amount = parseFloat(balance.available);
        if (amount > 1) {
          action = 'sell';
        }
      }
    }

    if (!action) {
      logJobValidation(symbol, 'No buy or sell condition met', nowStr, {
        change24h: change,
        buyThreshold: symbolConfig.buyThreshold,
        sellThreshold: symbolConfig.sellThreshold
      });
      return reply.send({ success: false, message: 'No buy or sell condition met. Price is outside buy/sell thresholds.' });
    }

    // 3. Execute order
    if (action === 'buy') {
      return await executeBuyOrder(symbol, symbolConfig, ticker, nowStr, reply);
    } 
    
    if (action === 'sell') {
      return await executeSellOrder(symbol, symbolConfig, ticker, nowStr, reply);
    }

  } catch (err) {
    logJobError(symbol, err, { timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ') });
    return reply.status(500).send({ error: err.message });
  }
}

// ===== BUY ORDER EXECUTION =====
async function executeBuyOrder(symbol, symbolConfig, ticker, nowStr, reply) {
  const currentPrice = parseFloat(ticker.lastPrice);
  
  // Validate sellThreshold is negative
  if (typeof symbolConfig.sellThreshold !== 'number' || symbolConfig.sellThreshold >= 0) {
    logJobValidation(symbol, 'Buy not allowed: sellThreshold must be negative', nowStr, {
      sellThreshold: symbolConfig.sellThreshold
    });
    return reply.send({
      success: false,
      message: `Buy not allowed: sellThreshold must be negative (current: ${symbolConfig.sellThreshold})`
    });
  }
  
  // Check price limit based on lastSellPrice
  if (symbolConfig.lastSellPrice) {
    const buyLimit = symbolConfig.lastSellPrice * (1 + (symbolConfig.sellThreshold / 100));
    if (currentPrice >= buyLimit) {
      logJobValidation(symbol, 'Buy skipped: price not below limit', nowStr, {
        currentPrice,
        lastSellPrice: symbolConfig.lastSellPrice,
        sellThreshold: symbolConfig.sellThreshold,
        buyLimit
      });
      return reply.send({
        success: false,
        message: `Buy skipped: current price (${currentPrice}) is not less than lastSellPrice (${symbolConfig.lastSellPrice}) + sellThreshold (${symbolConfig.sellThreshold}%) = ${buyLimit}`
      });
    }
  }
  
  // Price tracking check
  const priceCheck = await priceTrackingService.shouldBuyAtPrice(symbol, currentPrice);
  if (!priceCheck.shouldBuy) {
    logJobValidation(symbol, `price check failed: ${priceCheck.reason}`, nowStr, {
      currentPrice,
      priceCheck,
      change24h: ticker.changePercent24h
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
  let amount = Math.max(Math.floor(max), 10);
  
  if (amount < 25) {
    logJobFailure(symbol, 'insufficient BRL balance', nowStr, {
      availableBalance: max,
      requiredMin: 25,
      price: ticker.lastPrice,
      change24h: ticker.changePercent24h
    });
    return reply.send({ success: false, message: 'Insufficient BRL balance to buy.' });
  }
  
  // Execute buy order
  const op = await ordersService.createBuyOrder(symbol, amount);
  
  if (op.status === 'success') {
    await priceTrackingService.updatePriceTracking(symbol);
    await JobConfig.updateOne(
      { symbol },
      { $set: { lastBuyPrice: Number(currentPrice.toFixed(8)), updatedAt: new Date() } }
    );
    
    logJobMetric('buy_amount', symbol, amount);
    logJobMetric('buy_value_brl', symbol, amount);
    
    logJobExecution(symbol, 'buy', {
      value: `R$${amount}`,
      price: ticker.lastPrice,
      change24h: `${ticker.changePercent24h}%`,
      strategy: symbolConfig.sellStrategy,
      buyThreshold: symbolConfig.buyThreshold,
      sellThreshold: symbolConfig.sellThreshold
    }, nowStr);
  }
  
  return reply.send({ success: op.status === 'success', message: 'Buy order executed', op, priceCheck });
}

// ===== SELL ORDER EXECUTION =====
async function executeSellOrder(symbol, symbolConfig, ticker, nowStr, reply) {
  const baseCurrency = symbol.split('_')[0];
  const balance = await balanceService.getBalance(baseCurrency);
  const amount = parseFloat(balance.available);
  
  if (amount <= 0) {
    logJobFailure(symbol, 'insufficient balance to sell', nowStr, {
      availableBalance: amount,
      baseCurrency,
      price: ticker.lastPrice,
      change24h: ticker.changePercent24h
    });
    return reply.send({ success: false, message: 'Insufficient balance to sell.' });
  }

  const currentPrice = parseFloat(ticker.lastPrice);
  
  // Validate buyThreshold is positive
  if (typeof symbolConfig.buyThreshold !== 'number' || symbolConfig.buyThreshold <= 0) {
    logJobValidation(symbol, 'Sell not allowed: buyThreshold must be positive', nowStr, {
      buyThreshold: symbolConfig.buyThreshold
    });
    return reply.send({
      success: false,
      message: `Sell not allowed: buyThreshold must be positive (current: ${symbolConfig.buyThreshold})`
    });
  }
  
  // Check price limit based on lastBuyPrice
  if (symbolConfig.lastBuyPrice) {
    const sellLimit = symbolConfig.lastBuyPrice * (1 + (symbolConfig.buyThreshold / 100));
    if (currentPrice <= sellLimit) {
      logJobValidation(symbol, 'Sell skipped: price not above limit', nowStr, {
        currentPrice,
        lastBuyPrice: symbolConfig.lastBuyPrice,
        buyThreshold: symbolConfig.buyThreshold,
        sellLimit
      });
      return reply.send({
        success: false,
        message: `Sell skipped: current price (${currentPrice}) is not greater than lastBuyPrice (${symbolConfig.lastBuyPrice}) + buyThreshold (${symbolConfig.buyThreshold}%) = ${sellLimit}`
      });
    }
  }

  const strategyConfig = getStrategyConfig(symbolConfig);
  let tracker = partialSales.get(symbol);
  
  if (!tracker) {
    return await executeFirstSell(symbol, symbolConfig, strategyConfig, ticker, amount, currentPrice, nowStr, reply);
  } else {
    return await executeStrategySell(symbol, symbolConfig, strategyConfig, tracker, ticker, currentPrice, nowStr, reply);
  }
}

// ===== FIRST SELL EXECUTION =====
async function executeFirstSell(symbol, symbolConfig, strategyConfig, ticker, amount, currentPrice, nowStr, reply) {
  const priceCheck = await priceTrackingService.shouldSellAtPrice(symbol, currentPrice);
  if (!priceCheck.shouldSell) {
    logJobValidation(symbol, `price check failed: ${priceCheck.reason}`, nowStr, {
      currentPrice,
      priceCheck,
      change24h: ticker.changePercent24h,
      strategy: symbolConfig.sellStrategy
    });
    return reply.send({ 
      success: false, 
      message: `Sell skipped: ${priceCheck.reason}`,
      priceCheck
    });
  }
  
  const firstSellAmount = Math.floor(amount * strategyConfig.levels[0].percentage);
  if (firstSellAmount <= 0) {
    logJobFailure(symbol, 'calculated sell amount is zero', nowStr, {
      amount,
      percentage: strategyConfig.levels[0].percentage
    });
    return reply.send({ success: false, message: 'Sell amount is zero, cannot execute order.' });
  }
  
  const op = await ordersService.createSellOrder(symbol, firstSellAmount);
  
  if (op.status === 'success') {
    tracker = new PartialSaleTracker(symbol, amount, currentPrice, strategyConfig);
    partialSales.set(symbol, tracker);
    
    await priceTrackingService.updatePriceTracking(symbol);
    await JobConfig.updateOne(
      { symbol },
      { $set: { lastSellPrice: Number(currentPrice.toFixed(8)), updatedAt: new Date() } }
    );
    
    logJobMetric('sell_amount', symbol, firstSellAmount);
    logJobMetric('sell_value_brl', symbol, firstSellAmount * currentPrice);
    
    const percentage = (strategyConfig.levels[0].percentage * 100).toFixed(0);
    logStrategyExecution(symbol, symbolConfig.sellStrategy, {
      amount: firstSellAmount,
      percentage: `${percentage}%`,
      price: currentPrice,
      change24h: `${ticker.changePercent24h}%`,
      buyThreshold: symbolConfig.buyThreshold,
      sellThreshold: symbolConfig.sellThreshold
    }, nowStr);
    
    const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
    if (remainingTargets.length > 0) {
      console.log(`[MAVERICK] Strategy | Next targets: ${remainingTargets.map(l => `+${((l.price/tracker.firstSellPrice-1)*100).toFixed(1)}%`).join(', ')} | Trailing stop: ${tracker.trailingStop}`);
    }
    
    return reply.send({ 
      success: true, 
      message: `Sell order (${percentage}%) executed - ${strategyConfig.name} strategy activated`, 
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
    logJobFailure(symbol, `Sell order (${(strategyConfig.levels[0].percentage * 100).toFixed(0)}%) failed`, nowStr, {
      amount: firstSellAmount,
      price: currentPrice,
      orderStatus: op.status,
      orderError: op.error,
      strategy: symbolConfig.sellStrategy
    });
    return reply.send({ success: false, message: `Sell order (${(strategyConfig.levels[0].percentage * 100).toFixed(0)}%) failed`, op });
  }
}

// ===== STRATEGY SELL EXECUTION =====
async function executeStrategySell(symbol, symbolConfig, strategyConfig, tracker, ticker, currentPrice, nowStr, reply) {
  tracker.updateHighestPrice(currentPrice);
  const sellDecision = tracker.shouldSell(currentPrice);
  
  if (sellDecision.shouldSell) {
    const minSellValueBRL = strategyConfig.minSellValueBRL;
    const sellValueBRL = sellDecision.amount * currentPrice;
    
    if (sellValueBRL < minSellValueBRL) {
      logJobValidation(symbol, 'sale value below minimum', nowStr, {
        attemptedValue: sellValueBRL,
        minRequired: minSellValueBRL,
        amount: sellDecision.amount,
        price: currentPrice,
        strategy: symbolConfig.sellStrategy
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
      logJobFailure(symbol, 'calculated sell amount is zero', nowStr, {
        amount: sellDecision.amount
      });
      return reply.send({ success: false, message: 'Sell amount is zero, cannot execute order' });
    }
    
    const op = await ordersService.createSellOrder(symbol, sellAmount);
    
    if (op.status === 'success') {
      tracker.markLevelExecuted(sellDecision.level);
      
      logJobMetric('sell_amount', symbol, sellDecision.amount);
      logJobMetric('sell_value_brl', symbol, sellValueBRL);
      
      const strategyInfo = symbolConfig.byValue ? `Value-based (${symbolConfig.valueSellThreshold}%)` : symbolConfig.sellStrategy;
      logStrategyExecution(symbol, strategyInfo, {
        amount: sellDecision.amount,
        percentage: `${(sellDecision.level.percentage * 100).toFixed(0)}%`,
        price: currentPrice,
        reason: sellDecision.reason,
        buyThreshold: symbolConfig.buyThreshold,
        sellThreshold: symbolConfig.sellThreshold
      }, nowStr);
      
      if (tracker.isComplete()) {
        partialSales.delete(symbol);
        const metrics = tracker.getProfitMetrics();
        
        logJobMetric('strategy_profit_percent', symbol, parseFloat(metrics.profitPercent));
        logJobMetric('strategy_max_profit_percent', symbol, parseFloat(metrics.maxProfitPercent));
        
        logStrategyComplete(symbol, strategyInfo, metrics, nowStr);
        
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
        if (!symbolConfig.byValue) {
          const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
          console.log(`[MAVERICK] Strategy Update | Symbol: ${symbol} | Strategy: ${strategyInfo} | Remaining targets: ${remainingTargets.map(l => `+${((l.price/tracker.firstSellPrice-1)*100).toFixed(1)}%`).join(', ')} | Trailing stop: ${tracker.trailingStop}`);
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
      logJobFailure(symbol, `Sell order failed: ${sellDecision.reason}`, nowStr, {
        amount: sellDecision.amount,
        price: currentPrice,
        reason: sellDecision.reason,
        orderStatus: op.status,
        orderError: op.error,
        strategy: symbolConfig.sellStrategy
      });
      return reply.send({ success: false, message: `Sell order failed: ${sellDecision.reason}`, op });
    }
  } else {
    // No sell condition met - log current status
    if (symbolConfig.byValue) {
      const metrics = tracker.getProfitMetrics();
      const valueIncreasePercent = ((metrics.currentValueBRL - metrics.initialValueBRL) / metrics.initialValueBRL * 100).toFixed(2);
      
      logStrategyMonitoring(symbol, symbolConfig.sellStrategy, {
        currentPrice,
        currentValueBRL: metrics.currentValueBRL?.toFixed(2),
        valueIncreasePercent: `${valueIncreasePercent}%`,
        targetThreshold: `${symbolConfig.valueSellThreshold}%`
      }, nowStr);
      
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
      const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
      const profitPotential = ((tracker.highestPrice / tracker.firstSellPrice - 1) * 100).toFixed(2);
      
      logStrategyMonitoring(symbol, symbolConfig.sellStrategy, {
        currentPrice,
        highestPrice: tracker.highestPrice,
        profitPotential: `${profitPotential}%`,
        remainingTargets: remainingTargets.map(l => ({ percentage: l.percentage * 100, price: l.price })),
        trailingStop: tracker.trailingStop
      }, nowStr);
      
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

// ===== CONFIGURATION HANDLERS =====
async function jobConfigHandler(request, reply) {
  try {
    console.log('[MAVERICK CONFIG] Processing configuration update');
    console.log('[MAVERICK CONFIG] Request body:', JSON.stringify(request.body, null, 2));
    
    if (request.body.symbol) {
      console.log('[MAVERICK CONFIG] Processing symbol-specific config for:', request.body.symbol);
      
      const config = await jobService.updateConfig(request.body);
      console.log('[MAVERICK CONFIG] Full config returned:', JSON.stringify(config, null, 2));
      
      if (request.server.updateCronSchedule) {
        await request.server.updateCronSchedule();
      }
      
      const symbolConfig = config.symbols.find(s => s.symbol === request.body.symbol);
      console.log('[MAVERICK CONFIG] Found symbol config:', JSON.stringify(symbolConfig, null, 2));
      
      if (!symbolConfig) {
        console.error('[MAVERICK CONFIG] Symbol config not found in response');
        return reply.status(404).send({ error: 'Symbol configuration not found after update' });
      }
      
      logJobEvent('config_update', request.body.symbol, {
        buyThreshold: symbolConfig.buyThreshold,
        sellThreshold: symbolConfig.sellThreshold,
        enabled: symbolConfig.enabled,
        checkInterval: symbolConfig.checkInterval,
        sellStrategy: symbolConfig.sellStrategy
      });

      return reply.send(symbolConfig);
    } else {
      console.log('[MAVERICK CONFIG] Processing global config update');
      
      const config = await jobService.updateConfig(request.body);
    
      if (request.server.updateCronSchedule) {
        await request.server.updateCronSchedule();
      }
      
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
    console.error(`[MAVERICK CONFIG] Error: ${err.message}`);
    logJobError('system', err, { context: 'jobConfigHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

// ===== SYMBOL MANAGEMENT HANDLERS =====
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

// ===== STATUS HANDLERS =====
async function jobStatusDetailedHandler(request, reply) {
  try {
    const config = await jobService.status();
    
    logJobEvent('config_status', 'system', {
      totalSymbols: config.symbols.length,
      enabledSymbols: config.symbols.filter(s => s.enabled).length,
      disabledSymbols: config.symbols.filter(s => !s.enabled).length,
      cooldownMinutes: config.cooldownMinutes || 30
    });
    
    const getNextExecutionTime = (cronExpression) => {
      try {
        const parser = require('node-cron').parseExpression;
        const cronParser = parser(cronExpression);
        const nextDate = cronParser.next();
        return nextDate.toDate();
      } catch (err) {
        return null;
      }
    };

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

    const getLastExecutionTime = (symbol) => {
      const lastExec = lastExecutions.get(symbol);
      return lastExec ? new Date(lastExec) : null;
    };

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

    const enrichedSymbols = config.symbols.map(symbol => {
      const lastExec = getLastExecutionTime(symbol.symbol);
      const symbolNextExecution = getNextExecutionTime(symbol.checkInterval);
      const symbolTimeUntilNext = getTimeUntilNext(symbolNextExecution);
      const symbolReadableInterval = getReadableInterval(symbol.checkInterval);
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
        status: symbol.enabled ? 'ready' : 'disabled'
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
    if (!cron.validate(checkInterval)) {
      return reply.status(400).send({ error: 'Invalid interval format. Use cron format (ex: */5 * * * *)' });
    }
    
    const config = await jobService.updateConfig({ checkInterval });
    
    if (request.server.updateCronSchedule) {
      await request.server.updateCronSchedule();
    }
    
    return reply.send(config);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

// ===== STRATEGY STATUS HANDLER =====
async function jobStrategyStatusHandler(request, reply) {
  try {
    const strategies = [];
    for (const [symbol, tracker] of partialSales.entries()) {
      const metrics = tracker.getProfitMetrics();
      const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
      
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

// ===== PROFIT SUMMARY HANDLER =====
async function getProfitSummaryHandler(request, reply) {
  try {
    const sells = await Operation.find({ 
      type: 'sell', 
      status: 'success', 
      profit: { $exists: true } 
    });
    
    let totalProfit = 0;
    const bySymbol = {};
    
    for (const op of sells) {
      totalProfit += op.profit || 0;
      if (!bySymbol[op.symbol]) bySymbol[op.symbol] = 0;
      bySymbol[op.symbol] += op.profit || 0;
    }
    
    logJobEvent('profit_summary', 'system', {
      totalProfit: totalProfit.toFixed(2),
      operationsCount: sells.length,
      symbolsCount: Object.keys(bySymbol).length,
      avgProfitPerOperation: sells.length > 0 ? (totalProfit / sells.length).toFixed(2) : 0
    });
    
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

// ===== MONITORING HANDLERS (DEPRECATED) =====
async function getMonitoringStatusHandler(request, reply) {
  try {
    return reply.send({ message: 'Sem monitoramento ativo no momento.' });
  } catch (err) {
    logJobError('system', err, { context: 'getMonitoringStatusHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

async function stopMonitoringHandler(request, reply) {
  return reply.send({ success: false, message: 'Monitoring status is not tracked.' });
}

// ===== PRICE TRACKING HANDLERS =====
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
    
    logJobEvent('price_tracking_reset', symbol, {
      timestamp: new Date().toISOString()
    });
    
    return reply.send(result);
  } catch (err) {
    logJobError(request.params.symbol, err, { context: 'resetPriceTrackingHandler' });
    return reply.status(500).send({ error: err.message });
  }
}

// ===== BASIC STATUS HANDLERS =====
async function jobStatusHandler(request, reply) {
  try {
    const config = await jobService.status();
    const result = config.symbols.map(s => ({
      symbol: s.symbol,
      status: !!s.enabled
    }));
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

async function jobToggleHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const config = await jobService.toggleSymbol(symbol);
    return reply.send(config);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}

// ===== STRATEGY INFORMATION HANDLER =====
async function getAllStrategiesHandler(request, reply) {
  try {
    const strategies = Object.entries(sellStrategies).map(([type, strategy]) => {
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

// ===== MODULE EXPORTS =====
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