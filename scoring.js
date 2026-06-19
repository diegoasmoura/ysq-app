const items = require('./data/items.json');
const schemas = require('./data/schemas.json');

const TOTAL_ITEMS = items.length;

/**
 * Calcula a pontuação por esquema a partir das respostas brutas.
 * responses: array de { item_number, score }
 */
function computeScores(responses) {
  const byItem = new Map(responses.map(r => [r.item_number, r.score]));

  const results = schemas.map(schema => {
    const itemNumbers = [];
    for (let n = schema.start; n <= schema.end; n++) itemNumbers.push(n);

    const answered = itemNumbers.filter(n => byItem.has(n));
    const sum = answered.reduce((acc, n) => acc + byItem.get(n), 0);
    const maxPossible = itemNumbers.length * 6;
    const minPossible = itemNumbers.length * 1;
    const avg = answered.length ? sum / answered.length : null;

    // Contagem de respostas 4, 5, 6 (criterio classico do YSQ para "ativacao" do esquema)
    const count456 = answered.filter(n => byItem.get(n) >= 4).length;

    let level = null;
    if (avg !== null) {
      if (avg <= 2.0) level = 'Baixa';
      else if (avg <= 3.5) level = 'Moderada';
      else if (avg <= 4.5) level = 'Alta';
      else level = 'Muito Alta';
    }

    return {
      code: schema.code,
      name: schema.name,
      itemRange: `${schema.start}-${schema.end}`,
      totalItems: itemNumbers.length,
      answeredItems: answered.length,
      sum,
      maxPossible,
      minPossible,
      average: avg !== null ? Math.round(avg * 100) / 100 : null,
      count456,
      level
    };
  });

  const totalAnswered = responses.length;
  const progressPct = Math.round((totalAnswered / TOTAL_ITEMS) * 100);

  return { schemas: results, totalAnswered, totalItems: TOTAL_ITEMS, progressPct };
}

module.exports = { computeScores, TOTAL_ITEMS, items, schemas };
