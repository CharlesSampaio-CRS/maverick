const Fastify = require('fastify');
const axios = require('axios');
const crypto = require('crypto');
const cron = require('node-cron');

const fastify = Fastify({ logger: true });

const API_KEY = '';
const API_SECRET = '';
const BASE_URL = 'https://api.novadax.com';

// Configuração do job
const JOB_CONFIG = {
  checkInterval: '*/3 * * * *', // A cada 3 minutos
  enabled: true, // Habilitar/desabilitar o job
  symbols: [
    {
      symbol: 'MOG_BRL',
      buyThreshold: -8, // Queda de 8% para comprar (mais conservador)
      sellThreshold: 12, // Alta de 12% para vender (maior margem de lucro)
      enabled: true,
      // Novas configurações de proteção
      maxInvestmentPercent: 50, // Máximo 50% do saldo em BRL por operação
      stopLossPercent: -5, // Stop loss de 5% do preço de compra
      takeProfitPercent: 15, // Take profit de 15% do preço de compra
      minVolume24h: 10000, // Volume mínimo de 24h em BRL
      trendAnalysis: true, // Habilitar análise de tendência
      cooldownMinutes: 30 // Tempo de espera entre operações
    }
  ]
};

// Histórico de operações para controle de cooldown
global.operationHistory = {};

// Função para assinar requisições
function signRequest(method, path, query = '', body = null) {
  const timestamp = Date.now().toString();
  
  let signStr;
  
  if (method === 'GET') {
    // Para requisições GET: {método}\n{caminho}\n{query string ordenada}\n{timestamp}
    const sortedQuery = query ? query.split('&').sort().join('&') : '';
    signStr = `${method}\n${path}\n${sortedQuery}\n${timestamp}`;
  } else {
    // Para requisições POST: {método}\n{caminho}\n{MD5 do body}\n{timestamp}
    const content = body ? JSON.stringify(body) : '';
    const md5Hash = crypto.createHash('md5').update(content).digest('hex');
    signStr = `${method}\n${path}\n${md5Hash}\n${timestamp}`;
  }
  
  const signature = crypto
    .createHmac('sha256', API_SECRET)
    .update(signStr)
    .digest('hex');

  const headers = {
    'X-Nova-Access-Key': API_KEY,
    'X-Nova-Timestamp': timestamp,
    'X-Nova-Signature': signature,
  };

  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

// Criar uma ordem (compra ou venda)
async function createOrder(symbol, side, price, amount) {
  const path = '/v1/orders/create';
  const url = BASE_URL + path;
  const body = {
    symbol,
    side,
    type: 'MARKET',
    price,
    amount
  };

  const headers = signRequest('POST', path, null, body);
  const res = await axios.post(url, body, { headers });
  return res.data;
}

// Criar uma ordem de compra a mercado
async function createMarketBuyOrder(symbol, amount) {
  const path = '/v1/orders/create';
  const url = BASE_URL + path;
  const body = {
    symbol,
    side: 'BUY',
    type: 'MARKET',
    value: amount
  };

  console.log(`📤 Enviando ordem de compra para API:`, {
    url,
    body,
    symbol,
    amount
  });

  try {
    const headers = signRequest('POST', path, null, body);
    console.log(`🔐 Headers de autenticação gerados`);
    
    const res = await axios.post(url, body, { headers });
    console.log(`📥 Resposta da API:`, res.data);
    
    return res.data;
  } catch (error) {
    console.error('❌ Erro na função createMarketBuyOrder:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url,
      body
    });
    throw error;
  }
}

// Criar uma ordem de venda a mercado
async function createMarketSellOrder(symbol, amount) {
  const path = '/v1/orders/create';
  const url = BASE_URL + path;
  const body = {
    symbol,
    side: 'SELL',
    type: 'MARKET',
    amount: amount // Para venda, usar 'amount' (quantidade da moeda base)
  };

  console.log(`📤 Enviando ordem de venda para API:`, {
    url,
    body,
    symbol,
    amount
  });

  try {
    const headers = signRequest('POST', path, null, body);
    console.log(`🔐 Headers de autenticação gerados`);
    
    const res = await axios.post(url, body, { headers });
    console.log(`📥 Resposta da API:`, res.data);
    
    return res.data;
  } catch (error) {
    console.error('❌ Erro na função createMarketSellOrder:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url,
      body
    });
    throw error;
  }
}

// Obter saldo da conta
async function getBalances() {
  const path = '/v1/account/getBalance';
  const url = BASE_URL + path;
  const headers = signRequest('GET', path);

  try {
    const res = await axios.get(url, { headers });

    // Verificar se a resposta tem a estrutura esperada
    if (res.data && res.data.data) {
      // Filtrar apenas carteiras com saldo total maior que zero
      const balances = res.data.data.filter(wallet => {
        const available = parseFloat(wallet.available) || 0;
        const frozen = parseFloat(wallet.frozen) || 0;
        const total = available + frozen;
        return total > 0;
      }).map(wallet => ({
        currency: wallet.currency,
        available: parseFloat((parseFloat(wallet.available) || 0).toFixed(4)),
        frozen: parseFloat((parseFloat(wallet.frozen) || 0).toFixed(4)),
        total: parseFloat(((parseFloat(wallet.available) || 0) + (parseFloat(wallet.frozen) || 0)).toFixed(4))
      }));
      
      return {
        success: true,
        data: balances,
        total: balances.length
      };
    } else {
      return {
        success: false,
        error: 'Formato de resposta inesperado',
        data: res.data
      };
    }
  } catch (error) {
    console.error('❌ Erro detalhado:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers
    });
    
    let errorMessage = 'Erro desconhecido';
    
    if (error.response) {
      // Erro de resposta do servidor
      errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
      if (error.response.data) {
        errorMessage += ` - ${JSON.stringify(error.response.data)}`;
      }
    } else if (error.request) {
      // Erro de rede
      errorMessage = 'Erro de conexão com a API da NovaDAX';
    } else {
      // Outro erro
      errorMessage = error.message;
    }
    
    throw new Error(`Erro ao obter saldos: ${errorMessage}`);
  }
}

// Obter dados de ticker (preço e variação) de um símbolo
async function getTicker(symbol) {
  const path = '/v1/market/ticker';
  const query = `symbol=${symbol}`;
  const url = `${BASE_URL}${path}?${query}`;

  try {
    const res = await axios.get(url);

    // Verificar se a resposta tem a estrutura esperada
    if (res.data && res.data.data) {
      const tickerData = res.data.data;
      
      // Calcular variação 24h
      const lastPrice = parseFloat(tickerData.lastPrice) || 0;
      const open24h = parseFloat(tickerData.open24h) || 0;
      const change24h = lastPrice - open24h;
      const changePercent24h = open24h > 0 ? (change24h / open24h) * 100 : 0;
      
      return {
        success: true,
        symbol: tickerData.symbol,
        lastPrice: parseFloat(lastPrice.toFixed(4)),
        bidPrice: parseFloat((parseFloat(tickerData.bid) || 0).toFixed(4)),
        askPrice: parseFloat((parseFloat(tickerData.ask) || 0).toFixed(4)),
        highPrice: parseFloat((parseFloat(tickerData.high24h) || 0).toFixed(4)),
        lowPrice: parseFloat((parseFloat(tickerData.low24h) || 0).toFixed(4)),
        openPrice: parseFloat(open24h.toFixed(4)),
        volume: parseFloat((parseFloat(tickerData.baseVolume24h) || 0).toFixed(4)),
        quoteVolume: parseFloat((parseFloat(tickerData.quoteVolume24h) || 0).toFixed(4)),
        change24h: parseFloat(change24h.toFixed(4)),
        changePercent24h: parseFloat(changePercent24h.toFixed(4)),
        timestamp: tickerData.timestamp
      };
    } else {
      return {
        success: false,
        error: 'Formato de resposta inesperado',
        data: res.data
      };
    }
  } catch (error) {
    console.error('❌ Erro ao obter ticker:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    
    let errorMessage = 'Erro desconhecido';
    
    if (error.response) {
      // Erro de resposta do servidor
      errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
      if (error.response.data) {
        errorMessage += ` - ${JSON.stringify(error.response.data)}`;
      }
    } else if (error.request) {
      // Erro de rede
      errorMessage = 'Erro de conexão com a API da NovaDAX';
    } else {
      // Outro erro
      errorMessage = error.message;
    }
    
    throw new Error(`Erro ao obter ticker: ${errorMessage}`);
  }
}

// Função para obter histórico de preços (últimas 24h)
async function getPriceHistory(symbol, hours = 24) {
  const path = '/v1/market/kline';
  const query = `symbol=${symbol}&period=1m&size=${hours * 60}`;
  const url = `${BASE_URL}${path}?${query}`;

  try {
    const res = await axios.get(url);
    
    if (res.data && res.data.data) {
      return res.data.data.map(candle => ({
        timestamp: candle[0],
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5])
      }));
    }
    return [];
  } catch (error) {
    console.error('❌ Erro ao obter histórico de preços:', error.message);
    return [];
  }
}

// Função para análise de tendência
function analyzeTrend(priceHistory) {
  if (priceHistory.length < 10) return { trend: 'NEUTRAL', confidence: 0 };
  
  const recent = priceHistory.slice(-10);
  const older = priceHistory.slice(-20, -10);
  
  const recentAvg = recent.reduce((sum, p) => sum + p.close, 0) / recent.length;
  const olderAvg = older.reduce((sum, p) => sum + p.close, 0) / older.length;
  
  const trendChange = ((recentAvg - olderAvg) / olderAvg) * 100;
  
  if (trendChange > 2) return { trend: 'UPWARD', confidence: Math.abs(trendChange) };
  if (trendChange < -2) return { trend: 'DOWNWARD', confidence: Math.abs(trendChange) };
  return { trend: 'NEUTRAL', confidence: Math.abs(trendChange) };
}

// Função para verificar se está em cooldown
function isInCooldown(symbol) {
  const history = global.operationHistory[symbol];
  if (!history) return false;
  
  const cooldownMs = 30 * 60 * 1000; // 30 minutos
  return (Date.now() - history.lastOperation) < cooldownMs;
}

// Função para registrar operação
function registerOperation(symbol, type) {
  if (!global.operationHistory[symbol]) {
    global.operationHistory[symbol] = {
      operations: [],
      lastOperation: 0
    };
  }
  
  global.operationHistory[symbol].operations.push({
    type,
    timestamp: Date.now(),
    price: null // Será preenchido quando a ordem for executada
  });
  
  global.operationHistory[symbol].lastOperation = Date.now();
}

// Função para calcular quantidade segura de investimento
function calculateSafeInvestment(availableBalance, maxPercent) {
  const maxInvestment = (availableBalance * maxPercent) / 100;
  return Math.min(maxInvestment, availableBalance);
}

// Função para verificar se o volume é adequado
function isVolumeAdequate(volume, minVolume) {
  return volume >= minVolume;
}

// Job principal para monitorar variação e criar ordens
async function monitorSymbolAndBuy() {
  if (!JOB_CONFIG.enabled) {
    console.log('⏸️ Job de monitoramento desabilitado');
    return;
  }

  try {
    // Registrar a hora da verificação
    global.lastJobCheck = new Date();
    
    console.log(`🔍 Verificando variação dos símbolos...`);
    
    // Processar cada símbolo individualmente
    for (const symbolConfig of JOB_CONFIG.symbols) {
      if (!symbolConfig.enabled) {
        console.log(`⏸️ Símbolo ${symbolConfig.symbol} desabilitado`);
        continue;
      }
      
      try {
        console.log(`\n📊 Verificando ${symbolConfig.symbol}...`);
        
        // Verificar cooldown
        if (isInCooldown(symbolConfig.symbol)) {
          console.log(`⏳ ${symbolConfig.symbol} em cooldown. Aguardando...`);
          continue;
        }
        
        // Obter dados do ticker
        const tickerResult = await getTicker(symbolConfig.symbol);
        
        if (!tickerResult.success) {
          console.error(`❌ Erro ao obter dados do ticker ${symbolConfig.symbol}:`, tickerResult.error);
          continue;
        }
        
        const { changePercent24h, lastPrice, volume } = tickerResult;
        
        console.log(`📊 ${symbolConfig.symbol}: Variação 24h = ${changePercent24h.toFixed(2)}%, Preço atual = R$ ${lastPrice.toFixed(4)}`);
        
        // Verificar volume mínimo
        if (!isVolumeAdequate(volume, symbolConfig.minVolume24h)) {
          console.log(`⚠️ Volume 24h (${volume.toFixed(2)}) abaixo do mínimo (${symbolConfig.minVolume24h}). Pulando...`);
          continue;
        }
        
        // Análise de tendência (se habilitada)
        let trendAnalysis = { trend: 'NEUTRAL', confidence: 0 };
        if (symbolConfig.trendAnalysis) {
          const priceHistory = await getPriceHistory(symbolConfig.symbol, 2); // Últimas 2 horas
          trendAnalysis = analyzeTrend(priceHistory);
          console.log(`📈 Análise de tendência: ${trendAnalysis.trend} (confiança: ${trendAnalysis.confidence.toFixed(2)}%)`);
        }
        
        // Verificar se a variação está abaixo do threshold de compra (queda)
        if (changePercent24h <= symbolConfig.buyThreshold) {
          console.log(`📉 Variação de ${changePercent24h.toFixed(2)}% está abaixo do threshold de compra de ${symbolConfig.buyThreshold}%`);
          
          // Verificar tendência para compra (evitar comprar em tendência de queda forte)
          if (trendAnalysis.trend === 'DOWNWARD' && trendAnalysis.confidence > 5) {
            console.log(`⚠️ Tendência de queda forte detectada (${trendAnalysis.confidence.toFixed(2)}%). Aguardando estabilização...`);
            continue;
          }
          
          // Obter saldo em BRL
          const balanceResult = await getBalances();
          
          if (!balanceResult.success) {
            console.error('❌ Erro ao obter saldo:', balanceResult.error);
            continue;
          }
          
          const brlWallet = balanceResult.data.find(w => w.currency.toUpperCase() === 'BRL');
          
          if (!brlWallet || brlWallet.available <= 0) {
            console.log('💰 Sem saldo disponível em BRL para compra');
            continue;
          }
          
          console.log(`💰 Saldo disponível em BRL: R$ ${brlWallet.available.toFixed(4)}`);
          
          // Calcular quantidade segura a comprar (máximo 30% do saldo)
          const amountToBuy = calculateSafeInvestment(brlWallet.available, symbolConfig.maxInvestmentPercent);
          
          if (amountToBuy < 25) { // Mínimo de R$ 25
            console.log(`💰 Valor calculado (R$ ${amountToBuy.toFixed(2)}) muito baixo. Mínimo: R$ 25`);
            continue;
          }
          
          try {
            console.log(`🛒 Criando ordem de compra a mercado: ${amountToBuy.toFixed(4)} BRL de ${symbolConfig.symbol}`);
            console.log(`📊 Investimento: ${((amountToBuy / brlWallet.available) * 100).toFixed(1)}% do saldo disponível`);
            
            const orderResult = await createMarketBuyOrder(symbolConfig.symbol, amountToBuy);
            
            if (orderResult.success || orderResult.code === 'A10000') {
              console.log(`✅ Ordem de compra criada com sucesso!`);
              console.log(`📋 ID da ordem: ${orderResult.data?.id || 'N/A'}`);
              console.log(`💰 Valor: R$ ${amountToBuy.toFixed(4)}`);
              console.log(`📈 Símbolo: ${symbolConfig.symbol}`);
              
              // Registrar operação
              registerOperation(symbolConfig.symbol, 'BUY');
              
              // Armazenar preço de compra para stop loss
              if (orderResult.data?.id) {
                global.operationHistory[symbolConfig.symbol].lastBuyPrice = lastPrice;
              }
            } else {
              console.error('❌ Erro ao criar ordem:', orderResult.error || orderResult.message);
            }
            
          } catch (orderError) {
            console.error('❌ Erro ao criar ordem de compra:', orderError.message);
          }
          
        }
        // Verificar se a variação está acima do threshold de venda (alta)
        else if (changePercent24h >= symbolConfig.sellThreshold) {
          console.log(`📈 Variação de ${changePercent24h.toFixed(2)}% está acima do threshold de venda de ${symbolConfig.sellThreshold}%`);
          
          // Verificar tendência para venda (evitar vender em tendência de alta forte)
          if (trendAnalysis.trend === 'UPWARD' && trendAnalysis.confidence > 5) {
            console.log(`📈 Tendência de alta forte detectada (${trendAnalysis.confidence.toFixed(2)}%). Aguardando melhor momento...`);
            continue;
          }
          
          // Obter saldo da moeda base (primeira parte do símbolo, ex: MOG de MOG_BRL)
          const baseCurrency = symbolConfig.symbol.split('_')[0];
          const balanceResult = await getBalances();
          
          if (!balanceResult.success) {
            console.error('❌ Erro ao obter saldo:', balanceResult.error);
            continue;
          }
          
          const baseWallet = balanceResult.data.find(w => w.currency.toUpperCase() === baseCurrency.toUpperCase());
          
          if (!baseWallet || baseWallet.available <= 0) {
            console.log(`💰 Sem saldo disponível em ${baseCurrency} para venda`);
            continue;
          }
          
          console.log(`💰 Saldo disponível em ${baseCurrency}: ${baseWallet.available.toFixed(4)}`);
          
          // Vender 70% do saldo disponível (não tudo)
          const amountToSell = baseWallet.available * 0.7;
          
          try {
            console.log(`🛒 Criando ordem de venda a mercado: ${amountToSell.toFixed(4)} ${baseCurrency} de ${symbolConfig.symbol}`);
            console.log(`📊 Venda: ${((amountToSell / baseWallet.available) * 100).toFixed(1)}% do saldo disponível`);
            
            const orderResult = await createMarketSellOrder(symbolConfig.symbol, amountToSell);
            
            if (orderResult.success || orderResult.code === 'A10000') {
              console.log(`✅ Ordem de venda criada com sucesso!`);
              console.log(`📋 ID da ordem: ${orderResult.data?.id || 'N/A'}`);
              console.log(`💰 Quantidade: ${amountToSell.toFixed(4)} ${baseCurrency}`);
              console.log(`📈 Símbolo: ${symbolConfig.symbol}`);
              
              // Registrar operação
              registerOperation(symbolConfig.symbol, 'SELL');
            } else {
              console.error('❌ Erro ao criar ordem:', orderResult.error || orderResult.message);
            }
            
          } catch (orderError) {
            console.error('❌ Erro ao criar ordem de venda:', orderError.message);
          }
          
        } else {
          console.log(`✅ Variação de ${changePercent24h.toFixed(2)}% está dentro dos thresholds. Nenhuma ação necessária.`);
          console.log(`📊 Threshold de compra: ${symbolConfig.buyThreshold}%, Threshold de venda: ${symbolConfig.sellThreshold}%`);
        }
        
      } catch (symbolError) {
        console.error(`❌ Erro ao processar símbolo ${symbolConfig.symbol}:`, symbolError.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Erro no job de monitoramento:', error.message);
  }
}

// Função para calcular a próxima execução baseada no cron expression
function getNextRunTime(cronExpression) {
  const now = new Date();
  const parts = cronExpression.split(' ');
  
  // Para expressões simples como "*/3 * * * *" (a cada 3 minutos)
  if (parts[0].startsWith('*/')) {
    const interval = parseInt(parts[0].substring(2));
    const nextRun = new Date(now);
    nextRun.setMinutes(Math.ceil(now.getMinutes() / interval) * interval);
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);
    
    // Se a próxima execução for no passado, adicionar mais um intervalo
    if (nextRun <= now) {
      nextRun.setMinutes(nextRun.getMinutes() + interval);
    }
    
    return nextRun;
  }
  
  // Para outros padrões cron, retornar uma estimativa baseada no intervalo atual
  return new Date(now.getTime() + 3 * 60 * 1000); // 3 minutos como fallback
}

// Endpoint de compra
fastify.post('/buy', async (request, reply) => {
  const { symbol, amount } = request.body;

  if (!symbol || !amount) {
    reply.status(400).send({ 
      error: 'Parâmetros obrigatórios: symbol, amount' 
    });
    return;
  }

  // Validar valor mínimo de R$ 25
  if (amount < 25) {
    reply.status(400).send({ 
      error: 'Valor mínimo para compra é R$ 25,00',
      details: `Valor fornecido: R$ ${amount.toFixed(2)}`
    });
    return;
  }

  try {
    console.log(`🛒 Tentando criar ordem de compra: ${amount} BRL de ${symbol}`);
    const result = await createMarketBuyOrder(symbol, amount);
    
    // Verificar se a ordem foi criada com sucesso baseado na resposta da NovaDAX
    if (result.code === 'A10000' || result.success) {
      console.log(`✅ Ordem de compra criada com sucesso!`);
      console.log(`📋 ID da ordem: ${result.data?.id || 'N/A'}`);
      console.log(`💰 Valor: R$ ${amount.toFixed(4)}`);
      console.log(`📈 Símbolo: ${symbol}`);
      return result;
    } else {
      console.error('❌ Erro na resposta da API:', result);
      reply.status(400).send({ 
        error: 'Erro ao criar ordem de compra',
        details: result.message || result.error || 'Resposta inválida da API'
      });
    }
  } catch (err) {
    console.error('❌ Erro detalhado na criação da ordem:', {
      message: err.message,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      stack: err.stack
    });
    
    let errorMessage = 'Erro ao criar ordem de compra';
    let errorDetails = err.message;
    
    if (err.response?.data) {
      errorDetails = JSON.stringify(err.response.data);
    }
    
    reply.status(500).send({ 
      error: errorMessage,
      details: errorDetails
    });
  }
});

// Endpoint de venda
fastify.post('/sell', async (request, reply) => {
  const { symbol, amount } = request.body;

  if (!symbol || !amount) {
    reply.status(400).send({ 
      error: 'Parâmetros obrigatórios: symbol, amount' 
    });
    return;
  }

  try {
    console.log(`🛒 Tentando criar ordem de venda: ${amount} ${symbol.split('_')[0]} de ${symbol}`);
    const result = await createMarketSellOrder(symbol, amount);
    
    // Verificar se a ordem foi criada com sucesso baseado na resposta da NovaDAX
    if (result.code === 'A10000' || result.success) {
      console.log(`✅ Ordem de venda criada com sucesso!`);
      console.log(`📋 ID da ordem: ${result.data?.id || 'N/A'}`);
      console.log(`💰 Quantidade: ${amount.toFixed(4)} ${symbol.split('_')[0]}`);
      console.log(`📈 Símbolo: ${symbol}`);
      return result;
    } else {
      console.error('❌ Erro na resposta da API:', result);
      reply.status(400).send({ 
        error: 'Erro ao criar ordem de venda',
        details: result.message || result.error || 'Resposta inválida da API'
      });
    }
  } catch (err) {
    console.error('❌ Erro detalhado na criação da ordem:', {
      message: err.message,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      stack: err.stack
    });
    
    let errorMessage = 'Erro ao criar ordem de venda';
    let errorDetails = err.message;
    
    if (err.response?.data) {
      errorDetails = JSON.stringify(err.response.data);
    }
    
    reply.status(500).send({ 
      error: errorMessage,
      details: errorDetails
    });
  }
});

// Endpoint de saldo
fastify.get('/balance', async (request, reply) => {
  try {
    const result = await getBalances();
    
    if (result.success) {
      // Calcular totais por moeda
      const summary = result.data.reduce((acc, wallet) => {
        const currency = wallet.currency;
        
        if (!acc[currency]) {
          acc[currency] = {
            currency,
            available: 0,
            frozen: 0,
            total: 0
          };
        }
        
        acc[currency].available += wallet.available;
        acc[currency].frozen += wallet.frozen;
        acc[currency].total += wallet.total;
        
        return acc;
      }, {});
      
      // Formatar todos os valores para 4 casas decimais
      const formattedSummary = Object.values(summary).map(wallet => ({
        currency: wallet.currency,
        available: parseFloat(wallet.available.toFixed(4)),
        frozen: parseFloat(wallet.frozen.toFixed(4)),
        total: parseFloat(wallet.total.toFixed(4))
      }));
      
      return {
        summary: formattedSummary,
        total_wallets: result.total
      };
    } else {
      reply.status(400).send(result);
    }
  } catch (err) {
    fastify.log.error(err.response?.data || err.message);
    reply.status(500).send({ 
      success: false,
      error: 'Erro ao obter saldo da carteira',
      details: err.message 
    });
  }
});

// Endpoint de saldo de moeda específica
fastify.get('/balance/:currency', async (request, reply) => {
  const { currency } = request.params;
  
  try {
    const result = await getBalances();
    
    if (result.success) {
      const wallet = result.data.find(w => w.currency.toUpperCase() === currency.toUpperCase());
      
      if (wallet) {
        return {
          currency: wallet.currency,
          available: parseFloat(wallet.available.toFixed(4))
        };
      } else {
        reply.status(404).send({
          success: false,
          error: `Moeda ${currency} não encontrada ou sem saldo`
        });
      }
    } else {
      reply.status(400).send(result);
    }
  } catch (err) {
    fastify.log.error(err.response?.data || err.message);
    reply.status(500).send({ 
      success: false,
      error: 'Erro ao obter saldo da moeda',
      details: err.message 
    });
  }
});

// Endpoint de ticker (preço e variação)
fastify.get('/ticker/:symbol', async (request, reply) => {
  const { symbol } = request.params;
  
  try {
    const result = await getTicker(symbol);
    
    if (result.success) {
      return {
        success: true,
        symbol: result.symbol,
        price: {
          last: result.lastPrice,
          bid: result.bidPrice,
          ask: result.askPrice,
          high: result.highPrice,
          low: result.lowPrice,
          open: result.openPrice
        },
        variation: {
          change24h: result.change24h,
          changePercent24h: result.changePercent24h
        },
        volume: {
          base: result.volume,
          quote: result.quoteVolume
        },
        timestamp: result.timestamp
      };
    } else {
      reply.status(400).send(result);
    }
  } catch (err) {
    fastify.log.error(err.response?.data || err.message);
    reply.status(500).send({ 
      success: false,
      error: 'Erro ao obter dados do ticker',
      details: err.message 
    });
  }
});

// Endpoint para obter status do job
fastify.get('/job/status', async (request, reply) => {
  try {
    const nextRun = getNextRunTime(JOB_CONFIG.checkInterval);
    
    return {
      enabled: JOB_CONFIG.enabled,
      symbols: JOB_CONFIG.symbols.map(symbol => ({
        symbol: symbol.symbol,
        buyThreshold: symbol.buyThreshold,
        sellThreshold: symbol.sellThreshold,
        enabled: symbol.enabled
      })),
      checkInterval: JOB_CONFIG.checkInterval,
      nextRun: nextRun.toISOString(),
      lastCheck: global.lastJobCheck ? global.lastJobCheck.toISOString() : null
    };
  } catch (error) {
    fastify.log.error('Erro ao obter status do job:', error);
    reply.status(500).send({
      success: false,
      error: 'Erro ao obter status do job',
      details: error.message
    });
  }
});

// Endpoint para habilitar/desabilitar o job
fastify.post('/job/toggle', async (request, reply) => {
  JOB_CONFIG.enabled = !JOB_CONFIG.enabled;
  
  return {
    enabled: JOB_CONFIG.enabled,
    message: JOB_CONFIG.enabled ? 'Job habilitado' : 'Job desabilitado'
  };
});

// Endpoint para executar o job manualmente
fastify.post('/job/run', async (request, reply) => {
  try {
    await monitorSymbolAndBuy();
    return { success: true, message: 'Job executado manualmente' };
  } catch (error) {
    reply.status(500).send({ 
      success: false, 
      error: 'Erro ao executar job',
      details: error.message 
    });
  }
});

// Endpoint para atualizar configuração do job
fastify.post('/job/config', async (request, reply) => {
  const { symbols } = request.body;
  
  if (symbols) {
    JOB_CONFIG.symbols = symbols.map(symbol => ({
      symbol: symbol.symbol,
      buyThreshold: symbol.buyThreshold,
      sellThreshold: symbol.sellThreshold,
      enabled: symbol.enabled
    }));
  }
  
  // Reiniciar o cron job com nova configuração
  if (global.monitoringJob) {
    global.monitoringJob.stop();
  }
  
  global.monitoringJob = cron.schedule(JOB_CONFIG.checkInterval, monitorSymbolAndBuy, {
    scheduled: JOB_CONFIG.enabled
  });
  
  return {
    success: true,
    config: JOB_CONFIG,
    message: 'Configuração atualizada'
  };
});

// Endpoint para adicionar um novo símbolo
fastify.post('/job/symbols', async (request, reply) => {
  const { symbol, buyThreshold, sellThreshold, enabled = true } = request.body;
  
  if (!symbol || buyThreshold === undefined || sellThreshold === undefined) {
    reply.status(400).send({
      success: false,
      error: 'Parâmetros obrigatórios: symbol, buyThreshold, sellThreshold'
    });
    return;
  }
  
  // Verificar se o símbolo já existe
  const existingSymbol = JOB_CONFIG.symbols.find(s => s.symbol === symbol);
  if (existingSymbol) {
    reply.status(400).send({
      success: false,
      error: `Símbolo ${symbol} já existe na configuração`
    });
    return;
  }
  
  // Adicionar novo símbolo
  JOB_CONFIG.symbols.push({
    symbol,
    buyThreshold,
    sellThreshold,
    enabled
  });
  
  return {
    success: true,
    message: `Símbolo ${symbol} adicionado com sucesso`,
    symbol: { symbol, buyThreshold, sellThreshold, enabled }
  };
});

// Endpoint para remover um símbolo
fastify.delete('/job/symbols/:symbol', async (request, reply) => {
  const { symbol } = request.params;
  
  const symbolIndex = JOB_CONFIG.symbols.findIndex(s => s.symbol === symbol);
  if (symbolIndex === -1) {
    reply.status(404).send({
      success: false,
      error: `Símbolo ${symbol} não encontrado`
    });
    return;
  }
  
  const removedSymbol = JOB_CONFIG.symbols.splice(symbolIndex, 1)[0];
  
  return {
    success: true,
    message: `Símbolo ${symbol} removido com sucesso`,
    removedSymbol
  };
});

// Endpoint para atualizar um símbolo específico
fastify.put('/job/symbols/:symbol', async (request, reply) => {
  const { symbol } = request.params;
  const { buyThreshold, sellThreshold, enabled } = request.body;
  
  const symbolConfig = JOB_CONFIG.symbols.find(s => s.symbol === symbol);
  if (!symbolConfig) {
    reply.status(404).send({
      success: false,
      error: `Símbolo ${symbol} não encontrado`
    });
    return;
  }
  
  // Atualizar apenas os campos fornecidos
  if (buyThreshold !== undefined) symbolConfig.buyThreshold = buyThreshold;
  if (sellThreshold !== undefined) symbolConfig.sellThreshold = sellThreshold;
  if (enabled !== undefined) symbolConfig.enabled = enabled;
  
  return {
    success: true,
    message: `Símbolo ${symbol} atualizado com sucesso`,
    symbol: symbolConfig
  };
});

// Endpoint para obter configuração de um símbolo específico
fastify.get('/job/symbols/:symbol', async (request, reply) => {
  const { symbol } = request.params;
  
  const symbolConfig = JOB_CONFIG.symbols.find(s => s.symbol === symbol);
  if (!symbolConfig) {
    reply.status(404).send({
      success: false,
      error: `Símbolo ${symbol} não encontrado`
    });
    return;
  }
  
  return {
    success: true,
    symbol: symbolConfig
  };
});

// Endpoint de teste para verificar API privada
fastify.get('/test-api', async (request, reply) => {
  try {
    console.log('🧪 Testando API privada...');
    const result = await getBalances();
    
    if (result.success) {
      return {
        success: true,
        message: 'API privada funcionando corretamente',
        data: result.data.slice(0, 5) // Retorna apenas os primeiros 5 saldos
      };
    } else {
      return {
        success: false,
        message: 'Erro na API privada',
        error: result.error
      };
    }
  } catch (error) {
    console.error('❌ Erro no teste da API:', error);
    return {
      success: false,
      message: 'Erro no teste da API',
      error: error.message
    };
  }
});

// Endpoint para obter histórico de operações
fastify.get('/operations/history', async (request, reply) => {
  try {
    const history = global.operationHistory || {};
    
    // Formatar histórico para resposta
    const formattedHistory = Object.keys(history).map(symbol => ({
      symbol,
      totalOperations: history[symbol].operations.length,
      lastOperation: new Date(history[symbol].lastOperation).toISOString(),
      lastBuyPrice: history[symbol].lastBuyPrice || null,
      operations: history[symbol].operations.slice(-10).map(op => ({
        type: op.type,
        timestamp: new Date(op.timestamp).toISOString(),
        price: op.price
      }))
    }));
    
    return {
      success: true,
      history: formattedHistory,
      totalSymbols: formattedHistory.length
    };
  } catch (error) {
    fastify.log.error('Erro ao obter histórico:', error);
    reply.status(500).send({
      success: false,
      error: 'Erro ao obter histórico de operações',
      details: error.message
    });
  }
});

// Endpoint para obter status detalhado do job
fastify.get('/job/status/detailed', async (request, reply) => {
  try {
    const nextRun = getNextRunTime(JOB_CONFIG.checkInterval);
    
    return {
      enabled: JOB_CONFIG.enabled,
      symbols: JOB_CONFIG.symbols.map(symbol => {
        const history = global.operationHistory[symbol.symbol];
        return {
          symbol: symbol.symbol,
          buyThreshold: symbol.buyThreshold,
          sellThreshold: symbol.sellThreshold,
          enabled: symbol.enabled,
          maxInvestmentPercent: symbol.maxInvestmentPercent,
          stopLossPercent: symbol.stopLossPercent,
          takeProfitPercent: symbol.takeProfitPercent,
          minVolume24h: symbol.minVolume24h,
          trendAnalysis: symbol.trendAnalysis,
          cooldownMinutes: symbol.cooldownMinutes,
          lastOperation: history ? new Date(history.lastOperation).toISOString() : null,
          totalOperations: history ? history.operations.length : 0,
          lastBuyPrice: history ? history.lastBuyPrice : null,
          inCooldown: history ? isInCooldown(symbol.symbol) : false
        };
      }),
      checkInterval: JOB_CONFIG.checkInterval,
      nextRun: nextRun.toISOString(),
      lastCheck: global.lastJobCheck ? global.lastJobCheck.toISOString() : null
    };
  } catch (error) {
    fastify.log.error('Erro ao obter status detalhado:', error);
    reply.status(500).send({
      success: false,
      error: 'Erro ao obter status detalhado do job',
      details: error.message
    });
  }
});

// Inicializar servidor
fastify.listen({ port: 3000 }, err => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info('Servidor rodando na porta 3000');
  
  // Iniciar o job de monitoramento
  if (JOB_CONFIG.enabled) {
    global.monitoringJob = cron.schedule(JOB_CONFIG.checkInterval, monitorSymbolAndBuy, {
      scheduled: true
    });
    console.log(`🚀 Job de monitoramento iniciado para os símbolos a cada ${JOB_CONFIG.checkInterval} minutos`);
    console.log(`📊 Configurações dos símbolos:`);
    JOB_CONFIG.symbols.forEach(symbol => {
      console.log(`📊 ${symbol.symbol}: Threshold de compra: ${symbol.buyThreshold}%, Threshold de venda: ${symbol.sellThreshold}%`);
    });
  }
});
