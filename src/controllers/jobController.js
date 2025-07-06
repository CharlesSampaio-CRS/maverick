const jobService = require('../services/jobService');
const tickerService = require('../services/tickerService');
const balanceService = require('../services/balanceService');
const ordersService = require('../services/ordersService');
const Operation = require('../models/Operation');

async function jobStatusHandler(request, reply) {
  try {
    const result = await jobService.status();
    return reply.send(result.symbols || []);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}
async function jobToggleHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const result = await jobService.toggle(symbol);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}
async function jobRunHandler(request, reply) {
  try {
    const { symbol } = request.body;
    if (!symbol) {
      console.log('[JOB] Falha | Symbol não informado');
      return reply.status(400).send({ error: 'Parâmetro symbol obrigatório' });
    }
    // 1. Get symbol config
    const config = await jobService.getSymbol(symbol);
    if (!config.enabled) {
      console.log(`[JOB] Não executado | Symbol: ${symbol} | Motivo: símbolo desabilitado`);
      return reply.send({ success: false, message: 'Símbolo desabilitado' });
    }
    // 2. Get ticker data
    const ticker = await tickerService.get(symbol);
    if (!ticker.success) {
      console.log(`[JOB] Não executado | Symbol: ${symbol} | Motivo: erro ao obter ticker`);
      return reply.send({ success: false, message: 'Erro ao obter ticker', details: ticker });
    }
    // 3. Check volume
    if (ticker.quoteVolume24h < (config.minVolume24h || 0)) {
      console.log(`[JOB] Não executado | Symbol: ${symbol} | Motivo: volume 24h insuficiente | Variação 24h: ${ticker.changePercent24h}`);
      return reply.send({ success: false, message: 'Volume 24h insuficiente' });
    }
    // 4. Check cooldown
    const lastOp = await Operation.findOne({ symbol }).sort({ createdAt: -1 });
    if (lastOp) {
      const cooldown = (config.cooldownMinutes || 30) * 60 * 1000;
      if (Date.now() - lastOp.createdAt.getTime() < cooldown) {
        console.log(`[JOB] Não executado | Symbol: ${symbol} | Motivo: cooldown ativo | Variação 24h: ${ticker.changePercent24h}`);
        return reply.send({ success: false, message: 'Cooldown ativo, aguarde antes de operar novamente.' });
      }
    }
    // 5. Decide buy/sell
    const change = parseFloat(ticker.changePercent24h);
    let action = null;
    if (change <= config.buyThreshold) action = 'buy';
    else if (change >= config.sellThreshold) action = 'sell';
    else {
      console.log(`[JOB] Não executado | Symbol: ${symbol} | Variação 24h: ${ticker.changePercent24h} | Nenhuma condição de compra/venda atingida`);
      return reply.send({ success: false, message: 'Nenhuma condição de compra/venda atingida.' });
    }
    // 6. Get balance and calculate amount
    let amount;
    if (action === 'buy') {
      const brl = await balanceService.getByCurrency('BRL');
      const max = ((config.maxInvestmentPercent || 30) / 100) * parseFloat(brl.available || 0);
      amount = Math.max(Math.floor(max), 10); // mínimo R$10
      if (amount < 10) {
        console.log(`[JOB] Não executado | Symbol: ${symbol} | Motivo: saldo BRL insuficiente | Variação 24h: ${ticker.changePercent24h}`);
        return reply.send({ success: false, message: 'Saldo BRL insuficiente para comprar.' });
      }
      const op = await ordersService.buy(symbol, amount);
      console.log(`[JOB] Executado | Symbol: ${symbol} | Ação: COMPRA | Valor: R$${amount} | Variação 24h: ${ticker.changePercent24h}`);
      return reply.send({ success: op.status === 'success', message: 'Compra executada', op });
    } else {
      const coin = symbol.split('_')[0];
      const bal = await balanceService.getByCurrency(coin);
      amount = (parseFloat(bal.available || 0)) * 0.7; // vende 70%
      if (amount < 0.0001) {
        console.log(`[JOB] Não executado | Symbol: ${symbol} | Motivo: saldo insuficiente para vender | Variação 24h: ${ticker.changePercent24h}`);
        return reply.send({ success: false, message: 'Saldo insuficiente para vender.' });
      }
      const op = await ordersService.sell(symbol, amount);
      console.log(`[JOB] Executado | Symbol: ${symbol} | Ação: VENDA | Valor: ${amount} | Variação 24h: ${ticker.changePercent24h}`);
      return reply.send({ success: op.status === 'success', message: 'Venda executada', op });
    }
  } catch (err) {
    console.error(`[JOB] Erro | ${err.message}`);
    return reply.status(500).send({ error: err.message });
  }
}
async function jobConfigHandler(request, reply) {
  try {
    const result = await jobService.config(request.body);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}
async function jobAddSymbolHandler(request, reply) {
  try {
    const result = await jobService.addSymbol(request.body);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}
async function jobRemoveSymbolHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const result = await jobService.removeSymbol(symbol);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}
async function jobUpdateSymbolHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const result = await jobService.updateSymbol(symbol, request.body);
    return reply.send(result);
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
}
async function jobGetSymbolHandler(request, reply) {
  try {
    const { symbol } = request.params;
    const result = await jobService.getSymbol(symbol);
    return reply.send(result);
  } catch (err) {
    return reply.status(404).send({ error: err.message });
  }
}
async function jobStatusDetailedHandler(request, reply) {
  try {
    const result = await jobService.statusDetailed();
    return reply.send(result);
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
  jobStatusDetailedHandler
}; 