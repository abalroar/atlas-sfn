import {ANALYSIS_GROUPS, institutionRanking, metricLabel, metricNote, observationAt, validateInstitutionHistory} from './institution-data.js';
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

/** Deck da instituição: cada indicador no seu bloco da análise, com a leitura do último trimestre. */
export function institutionDeckCharts(charts) {
  const groupOf = key => ANALYSIS_GROUPS.find(group => group.metrics.includes(key) || group.more.includes(key));
  const order = ANALYSIS_GROUPS.flatMap(group => [...group.metrics, ...group.more]);
  return charts.map(chart => {
    const key = chart.id.replace(/^institution-/, ''), group = groupOf(key);
    return {...chart, topic: group?.id || 'outros', topicLabel: group?.title || 'Outros indicadores', reading: chartReading(chart), order: order.includes(key) ? order.indexOf(key) : order.length};
  }).sort((a, b) => a.order - b.order);
}
