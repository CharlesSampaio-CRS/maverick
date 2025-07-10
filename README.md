# Maverick - Automação de Ordens

Este sistema automatiza ordens de compra e venda de criptomoedas na NovaDAX através do Maverick, seguindo regras simples de variação de preço e saldo disponível.

## Regras Detalhadas de Compra e Venda

### COMPRA
1. O Maverick só tenta comprar se a variação de preço em 24h (`changePercent24h`) for **menor ou igual ao `buyThreshold`** configurado para o símbolo.
2. Só executa a compra se houver saldo em BRL **maior ou igual a R$25**.
3. Só permite comprar se o `sellThreshold` for negativo (ex: -8).
4. Se houver um `lastSellPrice` registrado, só compra se o preço atual for **menor** que:
   - `lastSellPrice * (1 + sellThreshold/100)`
   - Exemplo: `lastSellPrice = 100`, `sellThreshold = -10` → Limite = 100 * 0,90 = 90. Só compra se preço < 90.
5. O preço de compra também pode ser limitado por regras de tracking de preço (proteção contra compras em tendência de queda).

#### Exemplo de Compra
- `buyThreshold = -8`
- `sellThreshold = -10`
- Preço caiu -12% nas últimas 24h (`changePercent24h = -12`)
- Saldo BRL: R$50
- `lastSellPrice = 100`
- Preço atual = 89
- Limite de compra: 100 * 0,90 = 90
- **Compra será executada** (pois -12 <= -8, saldo suficiente, preço < 90)

### VENDA
1. O Maverick só tenta vender se a variação de preço em 24h (`changePercent24h`) for **maior ou igual ao `sellThreshold`** configurado para o símbolo.
2. Só executa a venda se houver saldo da moeda base **maior que 1 unidade**.
3. Só permite vender se o `buyThreshold` for positivo (ex: 10).
4. Se houver um `lastBuyPrice` registrado, só vende se o preço atual for **maior** que:
   - `lastBuyPrice * (1 + buyThreshold/100)`
   - Exemplo: `lastBuyPrice = 100`, `buyThreshold = 10` → Limite = 100 * 1,10 = 110. Só vende se preço > 110.
5. O valor mínimo de venda é R$50 (ou conforme configuração da estratégia).
6. Estratégias de venda podem dividir a venda em múltiplos níveis de preço e usar trailing stop.

#### Exemplo de Venda
- `sellThreshold = 5`
- `buyThreshold = 10`
- Preço subiu 8% nas últimas 24h (`changePercent24h = 8`)
- Saldo BTC: 2
- `lastBuyPrice = 100`
- Preço atual = 120
- Limite de venda: 100 * 1,10 = 110
- **Venda será executada** (pois 8 >= 5, saldo suficiente, preço > 110)

### Proteções e Observações
- O sistema nunca executa ordens se as condições de variação de preço e saldo não forem atendidas.
- O tracking de preços é atualizado automaticamente após cada operação bem-sucedida.
- Estratégias de venda podem ser configuradas para múltiplos níveis de saída e trailing stop.
- O Maverick nunca compra se o `sellThreshold` for zero ou positivo, e nunca vende se o `buyThreshold` for zero ou negativo.

## Endpoints Principais

- `GET /job/status` — Lista todos os símbolos e se estão ativos.
- `POST /job/config` — Atualiza a configuração de um símbolo ou global.
- `POST /job/interval` — Atualiza apenas o intervalo de execução dos jobs.
- `POST /job/toggle/:symbol` — Ativa/desativa um símbolo.
- `POST /job/run` — Executa o job para um símbolo específico.
- `DELETE /job/symbols/:symbol` — Remove um símbolo da automação.
- `GET /job/symbols/:symbol` — Busca a configuração de um símbolo.
- `GET /job/status/detailed` — Status detalhado de todos os símbolos.
- `GET /job/profit-summary` — Resumo de lucro/prejuízo total e por símbolo.
- `GET /job/strategies` — Lista todas as estratégias de venda disponíveis.
- `POST /job/reset-price-tracking/:symbol` — Reseta o tracking de preços de um símbolo.

## Exemplo de Configuração

```json
{
  "symbol": "BTC_BRL",
  "buyThreshold": -8,
  "sellThreshold": 5,
  "enabled": true,
  "checkInterval": "*/10 * * * *",
  "sellStrategy": "security"
}
```

## Exemplo de Fluxo de Compra
1. O preço do BTC caiu -9% nas últimas 24h.
2. O `buyThreshold` está em -8.
3. O saldo em BRL é R$100.
4. O bot executa a compra, pois -9 <= -8 e há saldo suficiente.

## Exemplo de Fluxo de Venda
1. O preço do BTC subiu 6% nas últimas 24h.
2. O `sellThreshold` está em 5.
3. O saldo de BTC é 2.
4. O bot executa a venda, pois 6 >= 5 e há saldo suficiente.

## Observações
- O sistema não executa ordens se as condições de variação de preço e saldo não forem atendidas.
- O tracking de preços é atualizado automaticamente após cada operação bem-sucedida.
- Estratégias de venda podem ser configuradas para múltiplos níveis de saída.

---

**Dúvidas ou sugestões?**
Abra uma issue ou entre em contato com o desenvolvedor. 