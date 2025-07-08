const newrelic = require('newrelic');
const jobService = require('../services/jobService');
const tickerService = require('../services/tickerService');
const balanceService = require('../services/balanceService');
const ordersService = require('../services/ordersService');
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

// Dynamic sale strategy configuration
const saleStrategyConfig = {
  levels: [
    { percentage: 0.3, priceIncrease: 0 },    // 30% on first sale
    { percentage: 0.3, priceIncrease: 0.05 }, // 30% at +5%
    { percentage: 0.2, priceIncrease: 0.10 }, // 20% at +10%
    { percentage: 0.2, priceIncrease: 0.15 }  // 20% at +15%
  ],
  trailingStop: 0.05, // 5% below the highest price
  minSellValueBRL: 50 // minimum R$50 per sale
};

// Enhanced partial sales tracking
class PartialSaleTracker {
  constructor(symbol, initialAmount, firstSellPrice) {
    this.symbol = symbol;
    this.initialAmount = initialAmount;
    this.firstSellPrice = firstSellPrice;
    this.remainingAmount = initialAmount;
    this.highestPrice = firstSellPrice;
    this.sellLevels = saleStrategyConfig.levels.map((level, idx) => ({
      percentage: level.percentage,
      price: firstSellPrice * (1 + level.priceIncrease),
      executed: idx === 0 // first sale already executed
    }));
    this.remainingAmount -= initialAmount * this.sellLevels[0].percentage;
    this.trailingStop = firstSellPrice * (1 - saleStrategyConfig.trailingStop);
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
  
  // Log cleanup summary
  if (cleanedCount > 0) {
    logJobEvent('cleanup_summary', 'system', {
      cleanedCount,
      remainingStrategies: partialSales.size,
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
  try {
    const { symbol } = request.body;
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

    // 2. Check cooldown
    const lastExec = lastExecutions.get(symbol) || 0;
    const cooldown = (config.cooldownMinutes || 30) * 60 * 1000;
    
    if (Date.now() - lastExec < cooldown) {
      const reason = 'cooldown active';
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Reason: ${reason} | Date: ${nowStr}`);
      logJobEvent('skipped', symbol, { 
        reason, 
        price: ticker.lastPrice, 
        change24h: ticker.changePercent24h, 
        timestamp: nowStr 
      });
      return reply.send({ success: false, message: 'Cooldown active, wait before operating again.' });
    }

    // 3. Check thresholds and decide action
    const change = parseFloat(ticker.changePercent24h);
    let action = null;
    
    if (change <= symbolConfig.buyThreshold) action = 'buy';
    else if (change >= symbolConfig.sellThreshold) action = 'sell';
    
    if (!action) {
      const reason = 'no buy/sell condition met';
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | ${reason} | Date: ${nowStr}`);
      logJobEvent('skipped', symbol, { 
        reason, 
        price: ticker.lastPrice, 
        change24h: ticker.changePercent24h,
        buyThreshold: symbolConfig.buyThreshold,
        sellThreshold: symbolConfig.sellThreshold,
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
      
      // Log buy execution
      logJobEvent('buy_executed', symbol, { 
        amount, 
        price: ticker.lastPrice, 
        change24h: ticker.changePercent24h,
        orderStatus: op.status,
        orderId: op.id,
        timestamp: nowStr 
      });
      
      if (op.status === 'success') {
        logJobMetric('buy_amount', symbol, amount);
        logJobMetric('buy_value_brl', symbol, amount);
      }
      
      console.log(`[JOB] Executed | Symbol: ${symbol} | Action: BUY | Value: R$${amount} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Date: ${nowStr}`);
      return reply.send({ success: op.status === 'success', message: 'Buy order executed', op });
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
      
      // Enhanced partial sale logic with multiple exit levels
      let tracker = partialSales.get(symbol);
      
      if (!tracker) {
        // First sale: sell 30% immediately, setup tracking for remaining 70%
        const firstSellAmount = amount * 0.3;
        const op = await ordersService.createSellOrder(symbol, firstSellAmount);
        
        if (op.status === 'success') {
          tracker = new PartialSaleTracker(symbol, amount, currentPrice);
          partialSales.set(symbol, tracker);
          
          // Log first sell execution
          logJobEvent('sell_first_executed', symbol, { 
            amount: firstSellAmount, 
            percentage: 30,
            price: currentPrice, 
            change24h: ticker.changePercent24h,
            orderStatus: op.status,
            orderId: op.id,
            strategy: 'multi_level_activated',
            timestamp: nowStr 
          });
          
          logJobMetric('sell_amount', symbol, firstSellAmount);
          logJobMetric('sell_value_brl', symbol, firstSellAmount * currentPrice);
          
          console.log(`[JOB] Executed | Symbol: ${symbol} | Action: SELL 30% | Amount: ${firstSellAmount} | Price: ${currentPrice} | 24h change: ${ticker.changePercent24h}% | Date: ${nowStr}`);
          console.log(`[JOB] Strategy | Next targets: +5% (${tracker.sellLevels[1].price}), +10% (${tracker.sellLevels[2].price}), +15% (${tracker.sellLevels[3].price}) | Trailing stop: ${tracker.trailingStop}`);
          
          return reply.send({ 
            success: true, 
            message: 'Sell order (30%) executed - Multi-level strategy activated', 
            op,
            strategy: {
              nextTargets: tracker.sellLevels.filter(l => !l.executed).map(l => ({ percentage: l.percentage * 100, price: l.price })),
              trailingStop: tracker.trailingStop
            }
          });
        } else {
          logJobEvent('sell_first_failed', symbol, { 
            amount: firstSellAmount, 
            price: currentPrice, 
            orderStatus: op.status,
            orderError: op.error,
            timestamp: nowStr 
          });
          return reply.send({ success: false, message: 'Sell order (30%) failed', op });
        }
      } else {
        // Update tracker with current price
        tracker.updateHighestPrice(currentPrice);
        
        // Check if we should sell based on strategy
        const sellDecision = tracker.shouldSell(currentPrice);
        
        if (sellDecision.shouldSell) {
          // NovaDAX requires a minimum sale of R$50 (or configured value)
          const minSellValueBRL = saleStrategyConfig.minSellValueBRL;
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
              timestamp: nowStr 
            });
            return reply.send({
              success: false,
              message: `Sale not executed: sale value (R$${sellValueBRL.toFixed(2)}) is less than the minimum of R$${minSellValueBRL}`,
              strategy: {
                requiredMinValue: minSellValueBRL,
                attemptedValue: sellValueBRL,
                attemptedAmount: sellDecision.amount,
                currentPrice
              }
            });
          }
          const op = await ordersService.createSellOrder(symbol, sellDecision.amount);
          
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
              strategy: 'multi_level',
              timestamp: nowStr 
            });
            
            logJobMetric('sell_amount', symbol, sellDecision.amount);
            logJobMetric('sell_value_brl', symbol, sellValueBRL);
            
            console.log(`[JOB] Executed | Symbol: ${symbol} | Action: SELL ${(sellDecision.level.percentage * 100).toFixed(0)}% | Amount: ${sellDecision.amount} | Price: ${currentPrice} | Reason: ${sellDecision.reason} | Date: ${nowStr}`);
            
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
                timestamp: nowStr 
              });
              
              logJobMetric('strategy_profit_percent', symbol, parseFloat(metrics.profitPercent));
              logJobMetric('strategy_max_profit_percent', symbol, parseFloat(metrics.maxProfitPercent));
              
              console.log(`[JOB] Strategy Complete | Symbol: ${symbol} | All levels executed | Total profit strategy finished`);
              console.log(`[JOB] Performance | Avg Sell Price: ${metrics.avgSellPrice} | Profit: +${metrics.profitPercent}% | Max Profit: +${metrics.maxProfitPercent}% | Highest Price: ${metrics.highestPrice}`);
              
              return reply.send({ 
                success: true, 
                message: `Sell order executed - Strategy complete: ${sellDecision.reason}`, 
                op,
                strategy: { 
                  status: 'complete', 
                  totalExecuted: true,
                  performance: metrics
                }
              });
            } else {
              // Log remaining targets
              const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
              console.log(`[JOB] Strategy Update | Remaining targets: ${remainingTargets.map(l => `+${((l.price/tracker.firstSellPrice-1)*100).toFixed(1)}%`).join(', ')} | Trailing stop: ${tracker.trailingStop}`);
              
              return reply.send({ 
                success: true, 
                message: `Sell order executed: ${sellDecision.reason}`, 
                op,
                strategy: {
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
            timestamp: nowStr 
          });
          
          console.log(`[JOB] Strategy Monitor | Symbol: ${symbol} | Current: ${currentPrice} | Highest: ${tracker.highestPrice} | Profit: +${profitPotential}% | Waiting for targets: ${remainingTargets.map(l => `+${((l.price/tracker.firstSellPrice-1)*100).toFixed(1)}%`).join(', ')} | Stop: ${tracker.trailingStop} | Date: ${nowStr}`);
          
          return reply.send({ 
            success: false, 
            message: 'Strategy active - waiting for price targets or trailing stop',
            strategy: {
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
      const isInCooldown = lastExec ? 
        (Date.now() - lastExec.getTime()) < ((config.cooldownMinutes || 30) * 60 * 1000) : 
        false;
      
      const cooldownEndTime = isInCooldown && lastExec ? 
        new Date(lastExec.getTime() + ((config.cooldownMinutes || 30) * 60 * 1000)) : 
        null;

      // Calcular próxima execução individual para cada símbolo
      const symbolNextExecution = getNextExecutionTime(symbol.checkInterval);
      const symbolTimeUntilNext = getTimeUntilNext(symbolNextExecution);
      const symbolReadableInterval = getReadableInterval(symbol.checkInterval);

      return {
        ...symbol,
        lastExecution: lastExec ? lastExec.toISOString() : null,
        isInCooldown,
        cooldownEndTime: cooldownEndTime ? cooldownEndTime.toISOString() : null,
        cooldownMinutes: config.cooldownMinutes || 30,
        nextExecution: symbolNextExecution ? symbolNextExecution.toISOString() : null,
        timeUntilNext: symbolTimeUntilNext,
        readableInterval: symbolReadableInterval,
        status: symbol.enabled ? 
          (isInCooldown ? 'cooldown' : 'ready') : 
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
      strategies.push({
        symbol,
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
  return reply.send(saleStrategyConfig);
}

// Endpoint to update the sale strategy configuration
async function updateSaleStrategyConfigHandler(request, reply) {
  try {
    const { levels, trailingStop, minSellValueBRL } = request.body;
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
      saleStrategyConfig.levels = levels;
    }
    if (typeof trailingStop === 'number') {
      if (trailingStop < 0.01 || trailingStop > 0.5) {
        return reply.status(400).send({ error: 'trailingStop must be between 0.01 and 0.5 (1% to 50%)' });
      }
      saleStrategyConfig.trailingStop = trailingStop;
    }
    if (typeof minSellValueBRL === 'number') {
      if (minSellValueBRL < 10) {
        return reply.status(400).send({ error: 'minSellValueBRL must be at least 10' });
      }
      saleStrategyConfig.minSellValueBRL = minSellValueBRL;
    }
    return reply.send(saleStrategyConfig);
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
}; 