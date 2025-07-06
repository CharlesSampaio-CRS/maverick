const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  // Removido o log de conexão
}

module.exports = {
  connectMongo,
  mongoose
}; 