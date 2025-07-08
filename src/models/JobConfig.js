const { mongoose } = require('../db/mongo');

const JobConfigSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true }, // Identificador único por símbolo
  buyThreshold: { type: Number, required: true },
  sellThreshold: { type: Number, required: true },
  enabled: { type: Boolean, default: true },
  checkInterval: { type: String, default: '*/30 * * * *' }, // Novo campo para intervalo individual
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Add indexes for better query performance (removed duplicate symbol index)
JobConfigSchema.index({ enabled: 1 });
JobConfigSchema.index({ symbol: 1, enabled: 1 });

// Configurações globais do sistema
const GlobalConfigSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  checkInterval: { type: String, default: '*/3 * * * *' },
  minVolume24h: { type: Number, default: 1000000 },
  cooldownMinutes: { type: Number, default: 30 },
  updatedAt: { type: Date, default: Date.now }
});

const JobConfig = mongoose.model('Config', JobConfigSchema);
const GlobalConfig = mongoose.model('GlobalConfig', GlobalConfigSchema);

module.exports = { JobConfig, GlobalConfig };