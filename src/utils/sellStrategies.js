// Estratégias de venda centralizadas

const sellStrategies = {
  security: {
    name: 'Security',
    description: 'Estratégia conservadora - vende 30% inicial e progressivo',
    levels: [
      { percentage: 0.3, priceIncrease: 0 },
      { percentage: 0.3, priceIncrease: 0.05 },
      { percentage: 0.2, priceIncrease: 0.10 },
      { percentage: 0.2, priceIncrease: 0.15 }
    ],
    trailingStop: 0.05, // 5% abaixo do preço mais alto
    minSellValueBRL: 50
  },
  basic: {
    name: 'Basic',
    description: 'Estratégia básica - vende 40% inicial e progressivo',
    levels: [
      { percentage: 0.4, priceIncrease: 0 },
      { percentage: 0.3, priceIncrease: 0.05 },
      { percentage: 0.3, priceIncrease: 0.10 }
    ],
    trailingStop: 0.05,
    minSellValueBRL: 50
  },
  aggressive: {
    name: 'Aggressive',
    description: 'Estratégia agressiva - vende 100% imediatamente',
    levels: [
      { percentage: 1.0, priceIncrease: 0 }
    ],
    trailingStop: 0.02,
    minSellValueBRL: 50
  }
};

module.exports = sellStrategies; 