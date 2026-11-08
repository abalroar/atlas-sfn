import {capitalCompositionChart, institutionChart, institutionExportCharts, institutionRanking, metricLabel, metricNote, observationAt, trimChartStart, validateInstitutionHistory} from './institution-data.js';
import {chartReading} from './editorial.js';

// Dados e ranking exportam as unidades originais do catálogo, explicitadas no arquivo.
export function institutionSnapshotCharts({bank, payload, metrics, period}) {
  validateInstitutionHistory(bank, payload);
  const row = observationAt(payload, period);
  if (!row) return [];
  return Object.keys(metrics).map(key => ({id:'institution-'+key, title:metricLabel(key, metrics), section:bank.name,
    unit:metrics[key].unit, percent:metrics[key].unit==='%', source:'BCB / IFData · '+bank.perimeter,
    note:metricNote(key, metrics), series:[{name:bank.name, type:'line', data:[[row.date, row.values[key] ?? null]]}]}));
}

export function rankingExportCharts(catalog, perimeter, key) {
  return institutionRanking(catalog, {perimeter, key}).map(({bank,rank}) => ({id:bank.id, title:bank.name, rank,
    section:'Ranking · '+perimeter, unit:catalog.metrics[key].unit, source:'BCB / IFData · '+perimeter,
    note:'Valores nas unidades originais do catálogo.', series:[{name:metricLabel(key,catalog.metrics), data:[[catalog.latestPeriod,bank.latest[key]]]}]}));
}

// Deck da instituição: oito gráficos, um par por bloco da análise. Cada gráfico junta indicadores
// de mesma natureza; o CSV traz os 23 indicadores separados, nas unidades dos gráficos.
const DECK = [
  ['balance', 'Balanço', 'Volumes do balanço', ['assets', 'funding', 'credit', 'deposits', 'liquidAssets', 'equity']],
  ['balance', 'Balanço', 'Crédito sobre captações', ['creditFunding']],
  ['result', 'Resultado', 'Lucro líquido', ['profitYtd', 'profitQuarter']],
  ['result', 'Resultado', 'ROE anualizado', ['roe', 'roeQuarter']],
  ['credit', 'Carteira', 'Qualidade da carteira', ['stage3Ratio', 'npl', 'problemAssets', 'expectedLossRatio', 'creditCost']],
  ['credit', 'Carteira', 'Estágios e perda esperada', ['stage2', 'stage3', 'expectedLoss']],
  ['capital', 'Capital', 'Composição do índice de Basileia', null],
  ['capital', 'Capital', 'Capital principal e RWA', ['capitalPrincipal', 'rwa']],
];
export function institutionDeckCharts({bank, payload, metrics, period, window = 'all'}) {
  const all = institutionExportCharts({bank, payload, metrics, period, window});
  return DECK.map(([topic, topicLabel, title, keys]) => {
    const available = keys ? keys.filter(key => metrics[key]) : null;
    if (available && !available.length) return null;
    const chart = trimChartStart(available ? institutionChart({bank, payload, metrics, keys: available, period, window, id: 'deck-' + available.join('-')}) : capitalCompositionChart({bank, payload, metrics, period, window}));
    const sources = available ? all.filter(entry => available.some(key => entry.id === 'institution-' + key)) : all.filter(entry => ['institution-cet1', 'institution-basel'].includes(entry.id));
    return {...chart, title, topic, topicLabel, reading: chartReading(chart), csvSources: sources};
  }).filter(chart => chart && chart.series.some(series => series.data.some(point => point[1] != null)));
}
