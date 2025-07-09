# NovaDAX Bot API

Node.js API for order automation on NovaDAX, using Fastify, MongoDB, and Swagger.

## Prerequisites
- Node.js 18+
- MongoDB

## Installation
```bash
git clone ...
cd ordersautomstic
npm install
cp .env.example .env # Edit with your keys
```

## Configuration
Edit the `.env` file with your NovaDAX keys and MongoDB connection string.

## Running the project
```bash
npm start
```

Access the Swagger documentation at: [http://localhost:3000/docs](http://localhost:3000/docs)

## Main Endpoints

- **POST /buy** — Create buy order
- **POST /sell** — Create sell order
- **GET /balance** — List balances
- **GET /balance/:currency** — Balance for a specific currency
- **GET /ticker/:symbol** — Price and variation
- **GET /operations/history** — Operations history

## Example buy request
```bash
curl -X POST http://localhost:3000/buy -H 'Content-Type: application/json' -d '{"symbol":"MOG_BRL","amount":100}'
```

## Features

### 📊 Market Endpoints
- `GET /ticker/:symbol` - Get price and variation data for a symbol
- `GET /balance` - Get all currency balances
- `GET /balance/:currency` - Get balance for a specific currency

### 🛒 Trading Endpoints
- `POST /buy` - Create a market buy order
- `POST /sell` - Create a market sell order

### 🤖 Monitoring Job Endpoints
- `GET /job/status` - Check monitoring job status
- `POST /job/toggle` - Enable/disable the job
- `POST /job/run` - Run the job manually
- `POST /job/config` - Update job configuration

### 📈 Symbol Management Endpoints
- `GET /job/symbols/:symbol` - Get configuration for a specific symbol
- `POST /job/symbols` - Add a new symbol to monitoring
- `PUT /job/symbols/:symbol` - Update configuration for a symbol
- `DELETE /job/symbols/:symbol` - Remove symbol from monitoring

## Automatic Monitoring Job

The system includes a job that runs every 3 minutes and monitors multiple symbols simultaneously:

1. **Monitors** the 24h variation of each configured symbol
2. **Checks** if the drop is greater than the buy threshold OR if the rise is greater than the sell threshold
3. **Creates** market buy orders (using BRL) or market sell orders (using the base currency)

### Default Configuration
```javascript
{
  checkInterval: '*/3 * * * *', // Every 3 minutes
  enabled: true,
  symbols: [
    {
      symbol: 'MOG_BRL',
      buyThreshold: -10,  // Buy on a 10% drop
      sellThreshold: 10,  // Sell on a 10% rise
      enabled: true
    },
    {
      symbol: 'BTC_BRL',
      buyThreshold: -15,  // Buy on a 15% drop
      sellThreshold: 15,  // Sell on a 15% rise
      enabled: true
    },
    {
      symbol: 'ETH_BRL',
      buyThreshold: -12,  // Buy on a 12% drop
      sellThreshold: 12,  // Sell on a 12% rise
      enabled: true
    }
  ]
}
```

### Usage Examples

#### Check job status:
```bash
curl http://localhost:3000/job/status
```

#### Run job manually:
```bash
curl -X POST http://localhost:3000/job/run
```

#### Buy MOG_BRL at market:
```bash
curl -X POST http://localhost:3000/buy \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "MOG_BRL",
    "amount": 100.00
  }'
```

#### Sell MOG at market:
```bash
curl -X POST http://localhost:3000/sell \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "MOG_BRL",
    "amount": 500.00
  }'
```

#### Add new symbol:
```bash
curl -X POST http://localhost:3000/job/symbols \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ADA_BRL",
    "buyThreshold": -8,
    "sellThreshold": 12,
    "enabled": true
  }'
```

#### Update symbol configuration:
```bash
curl -X PUT http://localhost:3000/job/symbols/BTC_BRL \
  -H "Content-Type: application/json" \
  -d '{
    "buyThreshold": -20,
    "sellThreshold": 25
  }'
```

#### Update job interval in real time:
```bash
# Change to run every 5 minutes
curl -X POST http://localhost:3000/job/interval \
  -H "Content-Type: application/json" \
  -d '{
    "checkInterval": "*/5 * * * *"
  }'

# Change to run every hour
curl -X POST http://localhost:3000/job/interval \
  -H "Content-Type: application/json" \
  -d '{
    "checkInterval": "0 * * * *"
  }'

# Change to run every 2 hours
curl -X POST http://localhost:3000/job/interval \
  -H "Content-Type: application/json" \
  -d '{
    "checkInterval": "0 */2 * * *"
  }'
```

#### Update entire job configuration:
```bash
curl -X POST http://localhost:3000/job/config \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "checkInterval": "*/10 * * * *",
    "symbols": [
      {
        "symbol": "BTC_BRL",
        "buyThreshold": -15,
        "sellThreshold": 20,
        "enabled": true
      }
    ]
  }'
```

#### Remove symbol:
```bash
curl -X DELETE http://localhost:3000/job/symbols/ETH_BRL
``` 