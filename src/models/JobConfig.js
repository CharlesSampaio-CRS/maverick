const { mongoose } = require('../db/mongo');

const JobConfigSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  checkInterval: { type: String, default: '*/3 * * * *' },
  symbols: [{
    symbol: { type: String, required: true },
    buyThreshold: { type: Number, required: true },
    sellThreshold: { type: Number, required: true },
    enabled: { type: Boolean, default: true }
  }],
  minVolume24h: { type: Number, default: 1000000 },
  cooldownMinutes: { type: Number, default: 30 },
  updatedAt: { type: Date, default: Date.now }
});

const JobConfig = mongoose.model('JobConfig', JobConfigSchema);

module.exports = JobConfig; 