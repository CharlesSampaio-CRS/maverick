const jobService = require('../services/jobService');
const tickerService = require('../services/tickerService');
const balanceService = require('../services/balanceService');
const ordersService = require('../services/ordersService');
const Operation = require('../models/Operation');
const cron = require('node-cron');

// In-memory storage for last execution times
const lastExecutions = new Map();
// In-memory storage for partial sales state
const partialSales = new Map();

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

      // Partial sale logic
      let partial = partialSales.get(symbol);
      if (!partial) {
        // First sale: sell 50%, store price
        const sellAmount = amount * 0.5;
        const op = await ordersService.createSellOrder(symbol, sellAmount);
        if (op.status === 'success') {
          partialSales.set(symbol, { firstSellPrice: parseFloat(ticker.lastPrice), remaining: amount - sellAmount });
          console.log(`[JOB] Executed | Symbol: ${symbol} | Action: SELL 50% | Value: ${sellAmount} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Date: ${nowStr}`);
          return reply.send({ success: true, message: 'Sell order (50%) executed', op });
        } else {
          return reply.send({ success: false, message: 'Sell order (50%) failed', op });
        }
      } else {
        // Second sale: only if price is higher than first sale
        if (parseFloat(ticker.lastPrice) > partial.firstSellPrice && partial.remaining > 0) {
          const op = await ordersService.createSellOrder(symbol, partial.remaining);
          if (op.status === 'success') {
            partialSales.delete(symbol); // Reset state
            console.log(`[JOB] Executed | Symbol: ${symbol} | Action: SELL REMAINING 50% | Value: ${partial.remaining} | Price: ${ticker.lastPrice} | 24h change: ${ticker.changePercent24h}% | Date: ${nowStr}`);
            return reply.send({ success: true, message: 'Sell order (remaining 50%) executed', op });
          } else {
            return reply.send({ success: false, message: 'Sell order (remaining 50%) failed', op });
          }
        } else {
          // Waiting for higher price
          console.log(`[JOB] Not executed | Symbol: ${symbol} | Waiting for higher price to sell remaining 50% | Last sell price: ${partial.firstSellPrice} | Current price: ${ticker.lastPrice} | Date: ${nowStr}`);
          return reply.send({ success: false, message: 'Waiting for higher price to sell remaining 50%.' });
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
  jobUpdateIntervalHandler
}; 