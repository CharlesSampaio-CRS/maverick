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

const Operation = mongoose.model('Operation', OperationSchema);

module.exports = Operation; 