const mongoose = require('mongoose');

async function connectMongo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    // Connection log removed
  } catch (err) {
    console.error('MongoDB connection error:', err);
    throw err;
  }
}

module.exports = {
  connectMongo,
  mongoose
}; 