const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('MongoDB conectado:', uri);
}

module.exports = {
  connectMongo,
  mongoose
}; 