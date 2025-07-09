# NovaDAX Bot API

API Node.js para automação de ordens na NovaDAX, com Fastify, MongoDB e Swagger.

## Pré-requisitos
- Node.js 18+
- MongoDB

## Instalação
```bash
git clone ...
cd ordersautomstic
npm install
cp .env.example .env # Edite com suas chaves
```

## Configuração
Edite o arquivo `.env` com suas chaves da NovaDAX e string do MongoDB.

## Rodando o projeto
```bash
npm start
```

Acesse a documentação Swagger em: [http://localhost:3000/docs](http://localhost:3000/docs)

## Endpoints principais

- **POST /buy** — Criar ordem de compra
- **POST /sell** — Criar ordem de venda
- **GET /balance** — Listar saldos
- **GET /balance/:currency** — Saldo de uma moeda
- **GET /ticker/:symbol** — Preço e variação
- **GET /operations/history** — Histórico de operações

## Exemplo de requisição de compra
```bash
curl -X POST http://localhost:3000/buy -H 'Content-Type: application/json' -d '{"symbol":"MOG_BRL","amount":100}'
```

## Funcionalidades

### 📊 Endpoints de Mercado
- `GET /ticker/:symbol` - Obter dados de preço e variação de um símbolo
- `GET /balance` - Obter saldo de todas as moedas
- `GET /balance/:currency` - Obter saldo de uma moeda específica

### 🛒 Endpoints de Trading
- `POST /buy` - Criar ordem de compra a mercado
- `POST /sell` - Criar ordem de venda a mercado

### 🤖 Endpoints do Job de Monitoramento
- `GET /job/status` - Verificar status do job de monitoramento
- `POST /job/toggle` - Habilitar/desabilitar o job
- `POST /job/run` - Executar o job manualmente
- `POST /job/config` - Atualizar configuração do job

### 📈 Endpoints de Gerenciamento de Símbolos
- `GET /job/symbols/:symbol` - Obter configuração de um símbolo específico
- `POST /job/symbols` - Adicionar novo símbolo ao monitoramento
- `PUT /job/symbols/:symbol` - Atualizar configuração de um símbolo
- `DELETE /job/symbols/:symbol` - Remover símbolo do monitoramento

## Job de Monitoramento Automático

O sistema inclui um job que executa a cada 3 minutos e monitora múltiplos símbolos simultaneamente:

1. **Monitora** a variação de 24h de cada símbolo configurado
2. **Verifica** se a queda é maior que o threshold de compra OU se a alta é maior que o threshold de venda
3. **Cria** ordens de compra a mercado (usando BRL) ou venda a mercado (usando a moeda base)

### Configuração Padrão
```javascript
{
  checkInterval: '*/3 * * * *', // A cada 3 minutos
  enabled: true,
  symbols: [
    {
      symbol: 'MOG_BRL',
      buyThreshold: -10,  // Compra em queda de 10%
      sellThreshold: 10,  // Vende em alta de 10%
      enabled: true
    },
    {
      symbol: 'BTC_BRL',
      buyThreshold: -15,  // Compra em queda de 15%
      sellThreshold: 15,  // Vende em alta de 15%
      enabled: true
    },
    {
      symbol: 'ETH_BRL',
      buyThreshold: -12,  // Compra em queda de 12%
      sellThreshold: 12,  // Vende em alta de 12%
      enabled: true
    }
  ]
}
```

### Exemplos de Uso

#### Verificar status do job:
```bash
curl http://localhost:3000/job/status
```

#### Executar job manualmente:
```bash
curl -X POST http://localhost:3000/job/run
```

#### Comprar MOG_BRL a mercado:
```bash
curl -X POST http://localhost:3000/buy \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "MOG_BRL",
    "amount": 100.00
  }'
```

#### Vender MOG a mercado:
```bash
curl -X POST http://localhost:3000/sell \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "MOG_BRL",
    "amount": 500.00
  }'
```

#### Adicionar novo símbolo:
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

#### Atualizar configuração de um símbolo:
```bash
curl -X PUT http://localhost:3000/job/symbols/BTC_BRL \
  -H "Content-Type: application/json" \
  -d '{
    "buyThreshold": -20,
    "sellThreshold": 25
  }'
```

#### Atualizar intervalo do job em tempo real:
```bash
# Alterar para executar a cada 5 minutos
curl -X POST http://localhost:3000/job/interval \
  -H "Content-Type: application/json" \
  -d '{
    "checkInterval": "*/5 * * * *"
  }'

# Alterar para executar a cada hora
curl -X POST http://localhost:3000/job/interval \
  -H "Content-Type: application/json" \
  -d '{
    "checkInterval": "0 * * * *"
  }'

# Alterar para executar a cada 2 horas
curl -X POST http://localhost:3000/job/interval \
  -H "Content-Type: application/json" \
  -d '{
    "checkInterval": "0 */2 * * *"
  }'
```

#### Atualizar toda a configuração do job:
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

#### Remover símbolo:
```bash
curl -X DELETE http://localhost:3000/job/symbols/ETH_BRL
```

#### Obter configuração de um símbolo:
```bash
curl http://localhost:3000/job/symbols/BTC_BRL
```

## Instalação

```bash
npm install
npm start
```

## Configuração

As credenciais da API estão configuradas no arquivo `src/server.js`:

```javascript
const API_KEY = 'sua-api-key';
const API_SECRET = 'seu-api-secret';
```

## Logs

O sistema gera logs detalhados de todas as operações:

- 🔍 Verificação de variação para cada símbolo
- 📊 Dados de preço e variação
- 💰 Saldo disponível
- 🛒 Criação de ordens de compra e venda
- ✅ Sucesso ou ❌ Erro nas operações

## Segurança

⚠️ **Importante**: As credenciais da API estão hardcoded no código. Em produção, use variáveis de ambiente:

```javascript
const API_KEY = process.env.NOVADAX_API_KEY;
const API_SECRET = process.env.NOVADAX_API_SECRET;
``` 

# Regras de Compra e Venda do Bot (Explicação para Leigos)

## Como o Bot Decide Quando Comprar e Vender

O bot foi criado para automatizar a compra e venda de criptomoedas, sempre buscando o melhor momento para lucrar e evitar prejuízos. Veja como ele funciona de forma simples:

### 1. Quando o Bot Compra?
- O bot fica de olho no preço da moeda.
- Ele só faz uma compra quando percebe que o preço caiu bastante em relação ao último valor de venda.
- Exemplo: Se o bot vendeu a moeda por R$ 100, ele só vai comprar de novo se o preço cair, por exemplo, para R$ 92 (ou seja, caiu 8%).
- Assim, o bot evita comprar quando o preço está alto.

### 2. Quando o Bot Vende?
- Depois de comprar, o bot espera o preço subir.
- Ele só vende se o preço subir bastante em relação ao valor que ele pagou na última compra.
- Exemplo: Se comprou por R$ 100, só vai vender se o preço subir para R$ 110 (ou seja, subiu 10%).
- Assim, o bot garante que só vende se for para ter lucro.

### 3. O que o Bot Nunca Faz
- Nunca compra mais caro do que vendeu.
- Nunca vende mais barato do que comprou.
- Sempre espera uma diferença mínima para garantir lucro.

### 4. Por que isso é importante?
- Essas regras protegem você de comprar na alta (quando está caro) e vender na baixa (quando está barato).
- O objetivo é sempre comprar barato e vender caro, aumentando as chances de lucro.

### 5. O que você precisa saber
- Você não precisa entender de gráficos ou acompanhar o mercado o tempo todo.
- O bot faz tudo sozinho, seguindo essas regras simples e seguras.

---

Se tiver dúvidas, peça ajuda para quem configurou o bot ou consulte este arquivo novamente! 