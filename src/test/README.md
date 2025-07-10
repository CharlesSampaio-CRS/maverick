# Testes do Sistema

Este diretório contém os testes automatizados para o sistema de trading automatizado.

## Estrutura dos Testes

### `jobController.test.js`
Testes abrangentes para o controlador principal de jobs, cobrindo:

- **Validações básicas**: Verificação de símbolos, status de habilitação, erros de ticker
- **Regras de compra**: Lógica de compra baseada em thresholds, validações de preço, verificações de saldo
- **Regras de venda**: Lógica de venda baseada em thresholds, estratégias de venda, validações
- **Estratégias de venda**: Testes das diferentes estratégias implementadas
- **Handlers de configuração**: Atualização de configurações, status detalhado
- **Handlers de símbolos**: Adição, remoção e toggle de símbolos
- **Handlers de preço**: Estatísticas e reset de tracking de preço
- **Tratamento de erros**: Captura e tratamento adequado de exceções

### `priceTrackingService.test.js`
Testes específicos para o serviço de tracking de preços:

- **shouldBuyAtPrice**: Validações de compra baseadas em preços anteriores
- **shouldSellAtPrice**: Validações de venda baseadas em preços anteriores
- **Cenários de edge cases**: Thresholds negativos, valores nulos, limites exatos

## Como Executar os Testes

```bash
# Executar todos os testes
npm test

# Executar testes em modo watch (desenvolvimento)
npm run test:watch

# Executar testes com cobertura
npm run test:coverage
```

## Cobertura de Testes

Os testes cobrem os seguintes cenários principais:

### Cenários de Compra
- ✅ Compra quando changePercent24h <= buyThreshold
- ✅ Não compra quando changePercent24h > buyThreshold
- ✅ Validação de sellThreshold negativo
- ✅ Verificação de limites baseados em lastSellPrice
- ✅ Verificação de saldo BRL mínimo
- ✅ Validação de price tracking

### Cenários de Venda
- ✅ Venda quando changePercent24h >= sellThreshold
- ✅ Não vende quando changePercent24h < sellThreshold
- ✅ Validação de buyThreshold positivo
- ✅ Verificação de limites baseados em lastBuyPrice
- ✅ Verificação de saldo da moeda base
- ✅ Validação de price tracking

### Estratégias de Venda
- ✅ Primeira venda com estratégia security
- ✅ Vendas subsequentes com condições atendidas
- ✅ Cálculo de métricas de lucro
- ✅ Trailing stop

### Configuração e Status
- ✅ Atualização de configurações de símbolos
- ✅ Atualização de configurações globais
- ✅ Status detalhado com informações enriquecidas
- ✅ Status de estratégias ativas
- ✅ Resumo de lucros

### Tratamento de Erros
- ✅ Erros de serviços externos
- ✅ Erros de validação
- ✅ Erros de configuração
- ✅ Captura de exceções

## Mocks Utilizados

- **jobService**: Mock do serviço de configuração de jobs
- **tickerService**: Mock do serviço de dados de ticker
- **balanceService**: Mock do serviço de saldos
- **ordersService**: Mock do serviço de ordens
- **priceTrackingService**: Mock do serviço de tracking de preços
- **JobConfig**: Mock do modelo de configuração
- **newrelic**: Mock do serviço de monitoramento

## Padrões de Teste

1. **Arrange-Act-Assert**: Estrutura clara de preparação, execução e verificação
2. **Mocks isolados**: Cada teste usa mocks independentes
3. **Cenários realistas**: Dados de teste que simulam situações reais
4. **Verificações específicas**: Assertions que verificam comportamento específico
5. **Limpeza de estado**: Reset de mocks entre testes

## Manutenção dos Testes

- Mantenha os testes atualizados quando a lógica de negócio mudar
- Adicione novos testes para novos cenários
- Execute testes regularmente durante o desenvolvimento
- Use cobertura de código para identificar áreas não testadas 