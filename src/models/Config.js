const { mongoose } = require('../db/mongo');

const ConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

const Config = mongoose.model('Config', ConfigSchema);

module.exports = Config; 