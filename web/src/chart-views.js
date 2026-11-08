// Formas de leitura derivadas dos gráficos publicados. Cada forma reorganiza os mesmos valores
// (ordem, posição, cor); nenhuma recalcula as séries de origem. Usadas pelo site e pelo PPTX.
import {chartCategories} from './data.js';
import {latestDate, monthLabel, retiredSeries, yearAgo} from './editorial.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);

/* ---------- Halteres: valor atual contra 12 meses antes ---------- */

/** Linhas ordenadas pelo valor atual. Séries encerradas e sem dado na data ficam fora (e são devolvidas). */
export function dumbbellRows(chart) {
  const dates = chart.series.map(latestDate).filter(Boolean).sort(), date = dates.at(-1);
  if (!date) return {date: null, rows: [], left: []};
  const rows = [], left = [];
  for (const series of chart.series) {
    const now = series.data.find(point => point[0] === date)?.[1];
    if (retiredSeries(series) || !finite(now)) {left.push(series.name); continue;}
    const before = yearAgo(series, date);
    rows.push({name: series.name, now, before: finite(before) ? before : null});
  }
  rows.sort((a, b) => b.now - a.now || a.name.localeCompare(b.name));
  const [year, month] = date.split('-').map(Number), earlier = new Date(Date.UTC(year - 1, month - 1, 1)).toISOString().slice(0, 10);
  return {date, earlier, rows, left, label: monthLabel(date), earlierLabel: monthLabel(earlier)};
}

/* ---------- Grade de UFs ---------- */

// Posição aproximada de cada UF numa grade de 6 colunas × 8 linhas, do norte ao sul.
export const UF_TILES = Object.freeze({
  RR: [1, 0], AP: [3, 0],
  AM: [1, 1], PA: [2, 1], MA: [3, 1], CE: [4, 1], RN: [5, 1],
  AC: [0, 2], RO: [1, 2], TO: [2, 2], PI: [3, 2], PE: [4, 2], PB: [5, 2],
  MT: [1, 3], GO: [2, 3], BA: [3, 3], SE: [4, 3], AL: [5, 3],
  MS: [1, 4], DF: [2, 4], MG: [3, 4], ES: [4, 4],
  PR: [1, 5], SP: [2, 5], RJ: [3, 5],
  SC: [1, 6],
  RS: [1, 7],
});
export const isUfChart = chart => chart.series.length === 1 && chart.series[0].data.length >= 20 && chart.series[0].data.every(([key]) => key in UF_TILES);

/** Tinta sequencial (clara para escura) pela posição entre mínimo e máximo observados. */
export function tileRamp(medium = 'web') {
  return medium === 'web' ? ['#fbe3cc', '#f6bf8c', '#f09a4f', '#ec7000', '#a64a00'] : ['FBE3CC', 'F6BF8C', 'F09A4F', 'EC7000', 'A64A00'];
}
export function ufTiles(chart, medium = 'web') {
  const values = chart.series[0].data.filter(([, value]) => finite(value)).map(([, value]) => value);
  const min = Math.min(...values), max = Math.max(...values), ramp = tileRamp(medium);
  const tiles = Object.entries(UF_TILES).map(([uf, [col, row]]) => {
    const value = chart.series[0].data.find(([key]) => key === uf)?.[1];
    const step = finite(value) && max > min ? Math.min(ramp.length - 1, Math.floor((value - min) / (max - min) * ramp.length)) : finite(value) ? ramp.length - 1 : -1;
    return {uf, col, row, value: finite(value) ? value : null, color: step < 0 ? (medium === 'web' ? '#e5e9e6' : 'EEEEEE') : ramp[step], dark: step >= 3};
  });
  return {tiles, min, max, ramp, cols: 6, rows: 8};
}

/* ---------- Matriz produto × canal ---------- */

export const CHANNEL_ORDER = ['Telefone Celular', 'Internet Banking', 'Agências', 'ATM', 'Correspondentes no País', 'Centrais de Atendimento', 'Posto de Atendimento Cooperativo'];
const CHANNEL_SHORT = {'Telefone Celular': 'Celular', 'Internet Banking': 'Internet', 'Agências': 'Agência', 'ATM': 'ATM', 'Correspondentes no País': 'Correspondente', 'Centrais de Atendimento': 'Central', 'Posto de Atendimento Cooperativo': 'Posto coop.'};

/**
 * Participação de cada canal no total do produto, na última competência comum. O denominador soma
 * os canais publicados naquela competência; canal sem registro fica N/D e fora da soma.
 */
export function channelMatrix(charts) {
  const sources = charts.filter(chart => /^spb-canais-\d+$/.test(chart.id));
  if (!sources.length) return null;
  const date = sources.map(chart => chart.series.map(latestDate).filter(Boolean).sort().at(-1)).filter(Boolean).sort()[0];
  if (!date) return null;
  const rows = sources.map(chart => {
    const values = Object.fromEntries(chart.series.map(series => [series.name, series.data.find(point => point[0] === date)?.[1]]).filter(([, value]) => finite(value)));
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    return {product: chart.title.replace(/ por canal de acesso$/, ''), id: chart.id, total, shares: Object.fromEntries(CHANNEL_ORDER.map(channel => [channel, channel in values && total > 0 ? values[channel] / total * 100 : null]))};
  }).filter(row => row.total > 0).sort((a, b) => b.total - a.total);
  const channels = CHANNEL_ORDER.filter(channel => rows.some(row => row.shares[channel] != null));
  return {date, label: monthLabel(date), unit: sources[0].unit, channels, short: CHANNEL_SHORT, rows, source: sources[0].source};
}

/** Gráfico sintético que carrega a matriz: as séries citam as participações para CSV e tabela. */
export function channelMatrixChart(charts) {
  const matrix = channelMatrix(charts);
  if (!matrix) return null;
  // Leitura: participação de cada canal no conjunto dos produtos (mesma unidade, mesma competência).
  const share = channel => {
    let part = 0, total = 0;
    for (const row of matrix.rows) {const value = row.shares[channel]; total += row.total; if (value != null) part += value / 100 * row.total;}
    return total > 0 ? part / total * 100 : null;
  };
  const mobileShare = share('Telefone Celular'), branchShare = share('Agências');
  const pct = value => value != null && value < 1 ? 'menos de 1%' : `${new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0}).format(value)}%`;
  return {id: 'spb-canais-matriz', title: 'Participação de cada canal, por produto', section: 'Meios de pagamento · SPB', unit: '% do produto', percent: true,
    source: matrix.source, latestPeriod: matrix.date, view: 'matrix', matrix,
    note: `Quantidade de transações de cada canal dividida pela soma dos canais publicados para o produto em ${matrix.label}. Canal sem registro na competência aparece como N/D e não entra na soma.`,
    reading: mobileShare != null ? {text: `O celular concentra ${pct(mobileShare)} das transações por canal em ${matrix.label}${branchShare != null ? `; a agência, ${pct(branchShare)}` : ''}`, date: matrix.date} : null,
    series: matrix.channels.map(channel => ({name: channel, type: 'bar', data: matrix.rows.map(row => [row.product, row.shares[channel]])}))};
}

/* ---------- Faixas de recessão no eixo de categorias ---------- */

/** Converte faixas de datas em pares de categorias existentes (primeira ≥ início, última ≤ fim). */
export function bandCategories(bands, categories) {
  return bands.map(band => {
    const inside = categories.filter(date => date >= band.from && date.slice(0, 7) <= band.to.slice(0, 7));
    return inside.length ? {...band, start: inside[0], end: inside.at(-1)} : null;
  }).filter(Boolean);
}

export const dateCategories = chart => {
  const dates = chartCategories(chart);
  return dates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date)) ? dates : [];
};
