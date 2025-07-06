const jobService = require('../services/jobService');
const tickerService = require('../services/tickerService');
const balanceService = require('../services/balanceService');
const ordersService = require('../services/ordersService');
const Operation = require('../models/Operation');
const cron = require('node-cron');

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
  
  for (const [symbol, tracker] of partialSales.entries()) {
    if (now - tracker.lastUpdate > maxAge) {
      console.log(`[JOB] Cleanup | Removing old strategy for ${symbol} | Age: ${((now - tracker.lastUpdate) / (60 * 60 * 1000)).toFixed(1)}h`);
      partialSales.delete(symbol);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupOldStrategies, 60 * 60 * 1000);

async function jobStatusHandler(request, reply) {
  try {
    const config = await jobService.status();
    return reply.send(config.symbols);
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

async function jobRunHandler(request, reply) {
  try {
    const { symbol } = request.body;
    const nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
    if (!symbol) {
      console.log(`[JOB] Failure | Symbol not provided | Date: ${nowStr}`);
      return reply.status(400).send({ error: 'Symbol is required' });
    }

    // 1. Get job configuration
    const config = await jobService.status();
    const symbolConfig = config.symbols.find(s => s.symbol === symbol);
    
    if (!symbolConfig || !symbolConfig.enabled) {
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Reason: symbol disabled | Date: ${nowStr}`);
      return reply.send({ success: false, message: 'Symbol is disabled' });
    }

    // 2. Get ticker data
    const ticker = await tickerService.getTicker(symbol);
    if (!ticker.success) {
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Reason: error getting ticker | Date: ${nowStr}`);
      return reply.send({ success: false, message: 'Error getting ticker data' });
    }

    // 3. Check cooldown
    const lastExec = lastExecutions.get(symbol) || 0;
    const cooldown = (config.cooldownMinutes || 30) * 60 * 1000;
    
    if (Date.now() - lastExec < cooldown) {
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Reason: cooldown active | Date: ${nowStr}`);
      return reply.send({ success: false, message: 'Cooldown active, wait before operating again.' });
    }

    // 4. Check thresholds and decide action
    const change = parseFloat(ticker.changePercent24h);
    let action = null;
    
    if (change <= config.buyThreshold) action = 'buy';
    else if (change >= config.sellThreshold) action = 'sell';
    
    if (!action) {
      console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | No buy/sell condition met | Date: ${nowStr}`);
      return reply.send({ success: false, message: 'No buy/sell condition met.' });
    }

    // 5. Execute order
    if (action === 'buy') {
      // Get BRL balance
      const balance = await balanceService.getBalance('BRL');
      const max = parseFloat(balance.available);
      let amount = Math.max(Math.floor(max), 10); // minimum R$10
      
      if (amount < 10) {
        console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Reason: insufficient BRL balance | Date: ${nowStr}`);
        return reply.send({ success: false, message: 'Insufficient BRL balance to buy.' });
      }
      
      const op = await ordersService.createBuyOrder(symbol, amount);
      console.log(`[JOB] Executed | Symbol: ${symbol} | Action: BUY | Value: R$${amount} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Date: ${nowStr}`);
      return reply.send({ success: op.status === 'success', message: 'Buy order executed', op });
    } else {
      // Get base currency balance
      const baseCurrency = symbol.split('_')[0];
      const balance = await balanceService.getBalance(baseCurrency);
      const amount = parseFloat(balance.available);
      
      if (amount <= 0) {
        console.log(`[JOB] Not executed | Symbol: ${symbol} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Reason: insufficient balance to sell | Date: ${nowStr}`);
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
            console.log(`[JOB] Sale NOT executed | Symbol: ${symbol} | Reason: sale value (R$${sellValueBRL.toFixed(2)}) is less than the minimum of R$${minSellValueBRL}`);
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
            
            console.log(`[JOB] Executed | Symbol: ${symbol} | Action: SELL ${(sellDecision.level.percentage * 100).toFixed(0)}% | Amount: ${sellDecision.amount} | Price: ${currentPrice} | Reason: ${sellDecision.reason} | Date: ${nowStr}`);
            
            // Check if strategy is complete
            if (tracker.isComplete()) {
              partialSales.delete(symbol);
              
              // Calculate final profit metrics
              const metrics = tracker.getProfitMetrics();
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
            return reply.send({ success: false, message: `Sell order failed: ${sellDecision.reason}`, op });
          }
        } else {
          // No sell condition met - log current status
          const remainingTargets = tracker.sellLevels.filter(l => !l.executed);
          const profitPotential = ((tracker.highestPrice / tracker.firstSellPrice - 1) * 100).toFixed(2);
          
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
    return reply.status(500).send({ error: err.message });
  }
}

async function jobConfigHandler(request, reply) {
  try {
    const config = await jobService.updateConfig(request.body);
    // Update cron schedule if available
    if (request.server.updateCronSchedule) {
      await request.server.updateCronSchedule();
    }
    return reply.send(config);
  } catch (err) {
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
    return reply.send(config);
  } catch (err) {
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
  updateSaleStrategyConfigHandler
}; 