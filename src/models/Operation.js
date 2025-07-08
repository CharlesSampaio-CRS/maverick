const { mongoose } = require('../db/mongo');

const OperationSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  type: { type: String, enum: ['buy', 'sell'], required: true },
  amount: { type: Number, required: true },
  price: { type: Number },
  status: { type: String, default: 'pending' },
  response: { type: Object },
  buyPrice: { type: Number },
  profit: { type: Number },
  createdAt: { type: Date, default: Date.now }
});

// Add indexes for better query performance
OperationSchema.index({ symbol: 1, type: 1, status: 1 });
OperationSchema.index({ symbol: 1, createdAt: -1 });
OperationSchema.index({ type: 1, status: 1 });
OperationSchema.index({ createdAt: -1 });
OperationSchema.index({ symbol: 1, type: 1, status: 1, createdAt: -1 });

const Operation = mongoose.model('Operation', OperationSchema);

module.exports = Operation; 