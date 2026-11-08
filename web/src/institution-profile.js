// Régua de posição: onde a instituição está entre todas as do mesmo perímetro, na última competência
// publicada. Valores e unidades do catálogo; a régua só posiciona os pontos.
import {institutionRanking, metricLabel, metricNumber, metricUnit, quarterLabel} from './institution-data.js';

export const PROFILE_KEYS = Object.freeze(['assets', 'credit', 'roe', 'stage3Ratio', 'npl', 'cet1', 'basel']);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q, low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** Escala da régua: logarítmica para volumes de grandezas muito diferentes; linear entre os percentis 2 e 98 nas demais. */
export function rulerScale(values, unit) {
  const sorted = values.filter(finite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const positive = sorted.filter(value => value > 0);
  if (unit === 'R$' && positive.length && positive.at(-1) / positive[0] > 50) {
    // Zero e valores negativos ficam na ponta esquerda; a escala usa os positivos.
    const lo = Math.log10(positive[0]), hi = Math.log10(positive.at(-1));
    return {kind: 'log', min: positive[0], max: positive.at(-1), clipped: positive.length < sorted.length, at: value => !finite(value) ? null : value <= 0 ? 0 : (Math.log10(value) - lo) / (hi - lo || 1)};
  }
  const lo = quantile(sorted, .02), hi = quantile(sorted, .98);
  return {kind: 'linear', min: lo, max: hi, at: value => finite(value) ? Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1))) : null, clipped: sorted[0] < lo || sorted.at(-1) > hi};
}

export function positionRulers(catalog, bank, keys = PROFILE_KEYS) {
  const period = catalog.latestPeriod;
  return keys.filter(key => catalog.metrics[key]).map(key => {
    const ranking = institutionRanking(catalog, {perimeter: bank.perimeter, key});
    const values = ranking.map(entry => entry.bank.latest[key]);
    const scale = rulerScale(values, catalog.metrics[key].unit);
    const own = ranking.find(entry => entry.bank.id === bank.id);
    const value = own ? own.bank.latest[key] : null;
    const median = quantile(values.slice().sort((a, b) => a - b), .5);
    return {key, label: metricLabel(key, catalog.metrics), unit: metricUnit(key, catalog.metrics, true), period, periodLabel: quarterLabel(period, true),
      count: ranking.length, rank: own?.rank ?? null, value, valueText: metricNumber(value, key, catalog.metrics), medianText: metricNumber(median, key, catalog.metrics),
      scale: scale?.kind || null, clipped: !!scale?.clipped,
      positions: scale ? values.map(scale.at).filter(position => position != null) : [], position: scale && finite(value) ? scale.at(value) : null,
      minText: scale ? metricNumber(scale.min, key, catalog.metrics) : 'N/D', maxText: scale ? metricNumber(scale.max, key, catalog.metrics) : 'N/D'};
  });
}
