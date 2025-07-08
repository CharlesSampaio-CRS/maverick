const { JobConfig, GlobalConfig } = require('../models/JobConfig');

// Cache configuration
const CACHE_TTL = {
  JOB_CONFIG: 30 * 1000, // 30 seconds
  TICKER: 5 * 1000,      // 5 seconds
  BALANCE: 10 * 1000,    // 10 seconds
  GLOBAL_CONFIG: 60 * 1000 // 1 minute
};

class CacheService {
  constructor() {
    this.cache = new Map();
    this.timestamps = new Map();
  }

  set(key, value, ttl = 30000) {
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now() + ttl);
  }

  get(key) {
    const timestamp = this.timestamps.get(key);
    if (!timestamp || Date.now() > timestamp) {
      this.cache.delete(key);
      this.timestamps.delete(key);
      return null;
    }
    return this.cache.get(key);
  }

  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }

  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }

  // Cache job configuration
  async getJobConfig() {
    const cached = this.get('job_config');
    if (cached) return cached;

    const config = await this.fetchJobConfig();
    this.set('job_config', config, CACHE_TTL.JOB_CONFIG);
    return config;
  }

  async fetchJobConfig() {
    // Get global config
    let globalConfig = await GlobalConfig.findOne().lean();
    if (!globalConfig) {
      globalConfig = {
        enabled: false,
        checkInterval: '*/3 * * * *',
        minVolume24h: 1000000
      };
    }

    // Get all symbol configs
    const symbolConfigs = await JobConfig.find().lean();
    
    return {
      checkInterval: globalConfig.checkInterval,
      minVolume24h: globalConfig.minVolume24h,
      symbols: symbolConfigs
    };
  }

  // Invalidate job config cache
  invalidateJobConfig() {
    this.delete('job_config');
  }

  // Cache ticker data
  getTicker(symbol) {
    return this.get(`ticker_${symbol}`);
  }

  setTicker(symbol, data) {
    this.set(`ticker_${symbol}`, data, CACHE_TTL.TICKER);
  }

  // Cache balance data
  getBalance(currency) {
    const key = currency ? `balance_${currency}` : 'balance_all';
    return this.get(key);
  }

  setBalance(currency, data) {
    const key = currency ? `balance_${currency}` : 'balance_all';
    this.set(key, data, CACHE_TTL.BALANCE);
  }

  invalidateBalance() {
    // Clear all balance cache entries
    for (const key of this.cache.keys()) {
      if (key.startsWith('balance_')) {
        this.delete(key);
      }
    }
  }
}

// Singleton instance
const cacheService = new CacheService();

module.exports = cacheService; 