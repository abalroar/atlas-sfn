// Camada editorial comum ao site e ao PPTX. Lê os gráficos publicados e devolve leituras,
// cores e escalas de exibição. Nenhum valor, unidade ou série de origem é alterado: as escalas
// valem só para os rótulos, e as leituras citam os números como publicados.
import {chartCategories} from './data.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthLabel = date => /^\d{4}-\d{2}/.test(date || '') ? `${MONTHS[Number(date.slice(5, 7)) - 1]}/${date.slice(0, 4)}` : date || 'N/D';
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

/* ---------- Cores por conceito ---------- */

// A mesma tinta para o mesmo conceito em todos os gráficos. PF fica na família laranja, PJ na
// família petróleo (site) ou grafite (PPTX); totais em tinta escura.
const CONCEPTS = [
  [/^PF livre$|^Taxa PF livre$/, 'pfFree'], [/^PF direcionado$/, 'pfDirected'], [/^PF total$|^PF inad$|^Spread PF$/, 'pfTotal'], [/^PF pré-inad$/, 'pfFree'],
  [/^PJ livre$|^Taxa PJ livre$/, 'pjFree'], [/^PJ direcionado$/, 'pjDirected'], [/^PJ total$|^PJ inad$|^Spread PJ$/, 'pjTotal'], [/^PJ pré-inad$/, 'pjFree'],
  [/^(Total SFN|SFN|Todos|Crédito ampliado|Inad total|Comprometimento total)$/, 'total'], [/^Pré-inad total$/, 'muted'], [/^CDI$/, 'reference'],
  [/^Pix$/, 'pix'], [/^Boleto|^Cobranças$/, 'boleto'], [/^TED$|^Transferências Interbancárias$/, 'ted'], [/^Cheque/, 'cheque'], [/^(DOC|TEC)$/, 'retired'],
  [/^Cartão de Crédito$|^Cartões$/, 'card'], [/^Cartão de Débito$/, 'debit'], [/^Telefone Celular$/, 'pix'], [/^Internet Banking$/, 'ted'], [/^Agências$/, 'boleto'], [/^ATM$/, 'cheque'],
  [/^SF público$|^Bancos públicos$|^Público$/, 'public'], [/^SF privado nacional$|^Privado nacional$/, 'national'], [/^SF privado estrangeiro$|^Privado estrangeiro$|^Estrangeiro$/, 'foreign'],
];
// Paleta do Atlas: PF na família ocre, PJ na família azul-petróleo (as tintas do relevo e do mar do filme),
// totais em tinta escura. Site e PPTX usam as mesmas cores.
const ATLAS = {pfFree: '#B07A1F', pfDirected: '#D9B77A', pfTotal: '#7A5214', pjFree: '#2C657F', pjDirected: '#8FB3C4', pjTotal: '#47869F', total: '#16323F', muted: '#9AA9AE', reference: '#8A7560',
  pix: '#B07A1F', boleto: '#2C657F', ted: '#6BA5BD', cheque: '#7A5214', retired: '#C9D1D0', card: '#47869F', debit: '#D9B77A', public: '#B07A1F', national: '#2C657F', foreign: '#9AC4D4'};
const ATLAS_SERIES = ['#2C657F', '#B07A1F', '#6BA5BD', '#7A5214', '#16323F', '#D9B77A', '#9AC4D4', '#8A7560', '#47869F', '#E3D3AF'];
const bare = color => color.slice(1);
export const CONCEPT_INK = {web: ATLAS, pptx: Object.fromEntries(Object.entries(ATLAS).map(([key, color]) => [key, bare(color)]))};
const FALLBACK = {web: ATLAS_SERIES, pptx: ATLAS_SERIES.map(bare)};
export const conceptOf = name => CONCEPTS.find(([pattern]) => pattern.test(String(name || '').trim()))?.[1] || null;

/** Uma cor por série: conceito conhecido primeiro, depois a paleta na ordem, sem repetir. */
export function seriesColors(chart, medium = 'web') {
  const ink = CONCEPT_INK[medium], out = [];
  const concepts = chart.series.map(series => conceptOf(series.name));
  // Um conceito só fica com a sua tinta quando ela ainda não foi usada no mesmo gráfico.
  const claimed = new Set(), wanted = concepts.map(concept => {
    if (!concept || claimed.has(ink[concept])) return null;
    claimed.add(ink[concept]);
    return ink[concept];
  });
  const free = FALLBACK[medium].filter(color => !claimed.has(color));
  let next = 0;
  for (const color of wanted) out.push(color || free[next++ % Math.max(1, free.length)] || FALLBACK[medium][0]);
  return out;
}

/* ---------- Escala de exibição ---------- */

// Para grandezas com muitos dígitos, divide-se só o rótulo: o arquivo e a tabela conservam a unidade
// publicada. `excel` usa a vírgula de escala do Office (cada vírgula final divide por mil).
const SCALES = {
  'mil transações': [[1e6, 'bi de transações'], [1e3, 'mi de transações']],
  'milhões de transações': [[1e3, 'bi de transações']],
  'transações': [[1e9, 'bi de transações'], [1e6, 'mi de transações']],
  'R$ milhões': [[1e6, 'R$ tri'], [1e3, 'R$ bi']],
  'R$': [[1e9, 'R$ bi'], [1e6, 'R$ mi']],
  'unidades': [[1e6, 'milhões'], [1e3, 'mil']],
  'terminais': [[1e6, 'milhões de terminais'], [1e3, 'mil terminais']],
};
export function displayScale(unit, values) {
  const top = Math.max(0, ...values.filter(finite).map(Math.abs));
  const options = SCALES[unit] || [];
  const [factor, label] = options.find(([factor]) => top / factor >= 1 && top / factor < 1e4) || options.find(([factor]) => top >= factor) || [1, unit];
  const commas = Math.round(Math.log10(factor) / 3);
  return {factor, unit: label, original: unit, excel: (top / factor < 100 ? '#,##0.0' : '#,##0') + ','.repeat(commas)};
}
export const chartValues = chart => chart.series.flatMap(series => series.data.map(point => point[1]));

/* ---------- Números ---------- */

const fmt = (value, digits) => new Intl.NumberFormat('pt-BR', {minimumFractionDigits: digits, maximumFractionDigits: digits}).format(Object.is(value, -0) ? 0 : value);
/** Casas decimais pela grandeza: 7.444 · 34,6 · 3,92 · 0,47. */
export function readable(value) {
  if (!finite(value)) return 'N/D';
  const magnitude = Math.abs(value);
  return fmt(value, magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2);
}
const signed = (value, text) => (value > 0 ? '+' : value < 0 ? '−' : '') + text.replace('-', '');
const isPercentUnit = unit => /%/.test(unit || '');
const isGrowthUnit = unit => /^(Δ|variação)/i.test(unit || '');

/** Valor com a unidade publicada, em forma de leitura. */
export function quantity(value, unit) {
  if (!finite(value)) return 'N/D';
  const scale = displayScale(unit, [value]), shown = value / scale.factor, text = readable(shown), label = scale.unit || '';
  if (label === 'milhões de transações') return `${text} mi de transações`;
  if (/^R\$/.test(label)) {const rest = label.slice(2).trim().replace(/^bilhões$/, 'bi').replace(/^milhões$/, 'mi'); return `R$ ${text.replace('-', '−')}${rest ? ' ' + rest : ''}`;}
  if (/% a\.a\./.test(label)) return `${text}% a.a.`;
  if (isGrowthUnit(label)) return signed(value, `${fmt(Math.abs(value), 1)}${/%/.test(label) ? '%' : ' p.p.'}`);
  if (isPercentUnit(label)) return `${text}%`;
  if (label === 'meses') return `${text} meses`;
  return label ? `${text} ${label}` : text;
}

/* ---------- Série temporal: último valor e comparação de 12 meses ---------- */

function at(series, date) {return series.data.find(point => point[0] === date)?.[1];}
function shiftMonths(date, months) {
  const [year, month] = date.split('-').map(Number), shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return shifted.toISOString().slice(0, 7);
}
/** Valor do mesmo mês 12 meses antes (séries mensais ou trimestrais), ou N/D. */
export function yearAgo(series, date) {
  const target = shiftMonths(date, -12);
  return series.data.find(point => point[0].slice(0, 7) === target)?.[1];
}
export function latestDate(series) {
  return series.data.filter(point => finite(point[1]) && isDate(point[0])).map(point => point[0]).sort().at(-1) || null;
}
export function lastObserved(chart) {
  return chart.series.map(latestDate).filter(Boolean).sort().at(-1) || null;
}

/** Série encerrada: os quatro últimos registros publicados são zero e houve atividade antes. */
export function retiredSeries(series) {
  const observed = series.data.filter(point => finite(point[1]) && isDate(point[0])).sort((a, b) => a[0].localeCompare(b[0]));
  if (observed.length < 6) return null;
  const tail = observed.slice(-4);
  if (!tail.every(point => point[1] === 0)) return null;
  const active = observed.filter(point => point[1] !== 0).at(-1);
  return active ? {name: series.name, last: active[0]} : null;
}

/** Mudança de 12 meses: % para níveis, p.p. para taxas e participações. */
function change(now, before, unit) {
  if (!finite(now) || !finite(before)) return null;
  if (isPercentUnit(unit) || isGrowthUnit(unit) || unit === 'meses') return {value: now - before, unit: unit === 'meses' ? 'meses' : 'p.p.'};
  // Variação percentual só faz sentido entre valores positivos; com sinal negativo, a leitura omite a comparação.
  if (before <= 0 || now < 0) return null;
  return {value: (now / before - 1) * 100, unit: '%'};
}
export function changeText(delta) {
  if (!delta) return '';
  const size = Math.abs(delta.value), digits = size >= 100 ? 0 : size > 0 && size < .1 ? 2 : 1;
  if (fmt(Math.abs(delta.value), digits).replace(/[0,]/g, '') === '') return 'estável';
  if (delta.unit === 'meses') return `${signed(delta.value, fmt(delta.value, digits))} ${Math.abs(delta.value) === 1 ? 'mês' : 'meses'}`;
  return `${signed(delta.value, fmt(delta.value, digits))}${delta.unit === '%' ? '%' : ' p.p.'}`;
}

const READING_NAMES = {Todos: 'Todas as faixas de renda', 'Inad total': 'Inadimplência total', 'Pré-inad total': 'Pré-inadimplência total', 'PF inad': 'Inadimplência PF', 'PJ inad': 'Inadimplência PJ'};
const LEAD = /^(Total SFN|SFN|Todos|Crédito ampliado|Inad total|Comprometimento total|PF total|PJ total|Taxa PF livre)$/;
const TOTAL_UNITS = /^(R\$|mil transações|milhões de transações|transações|unidades|terminais)/;

/** Série principal de um gráfico de linhas: total declarado ou maior último valor. */
function leadSeries(chart) {
  const usable = chart.series.filter(series => series.axis !== 1 && latestDate(series));
  return usable.find(series => LEAD.test(series.name)) || usable.slice().sort((a, b) => Math.abs(at(b, latestDate(b)) ?? 0) - Math.abs(at(a, latestDate(a)) ?? 0))[0] || null;
}

function stackedTotal(chart, date) {
  const values = chart.series.filter(series => series.axis !== 1).map(series => at(series, date));
  return values.every(finite) ? values.reduce((sum, value) => sum + value, 0) : null;
}

/**
 * Leitura de um gráfico: {kicker, text, figures[]} a partir da série original (sem recorte de período).
 * Quando falta um dado para comparar, a leitura omite a comparação.
 */
export function chartReading(chart) {
  const unit = chart.axes?.[0] || chart.unit || '';
  const dates = chartCategories(chart);
  if (!dates.length) return null;
  if (!dates.every(isDate)) {
    const series = chart.series[0], points = series.data.filter(point => finite(point[1]));
    if (points.length < 2) return null;
    const sorted = points.slice().sort((a, b) => b[1] - a[1]), top = sorted[0], bottom = sorted.at(-1);
    return {text: `Maior em ${top[0]} (${quantity(top[1], unit)}), menor em ${bottom[0]} (${quantity(bottom[1], unit)})`, date: chart.latestPeriod || null,
      figures: [{label: top[0], value: top[1], unit}, {label: bottom[0], value: bottom[1], unit}]};
  }
  const latest = lastObserved(chart);
  if (!latest) return null;
  const bars = chart.series.filter(series => series.type === 'bar' && series.axis !== 1);
  const when = monthLabel(latest);
  // Barras empilhadas em nível: o total da pilha.
  if (chart.stacked && bars.length > 1 && !isPercentUnit(unit) && TOTAL_UNITS.test(unit)) {
    const complete = latestComplete(chart);
    if (!complete) return null;
    const total = stackedTotal(chart, complete), delta = change(total, stackedTotalByMonth(chart, shiftMonths(complete, -12)), unit);
    return {text: `${quantity(total, unit)} em ${monthLabel(complete)}${delta ? `, ${changeText(delta)} em 12 meses` : ''}`, date: complete,
      figures: [{label: 'Total', value: total, unit, delta}]};
  }
  // Participações empilhadas: a maior fatia.
  if (chart.stacked && isPercentUnit(unit)) {
    const ranked = chart.series.map(series => ({series, value: at(series, latest)})).filter(entry => finite(entry.value) && !/^Outros$/.test(entry.series.name)).sort((a, b) => b.value - a.value);
    if (!ranked.length) return null;
    const {series, value} = ranked[0], delta = change(value, yearAgo(series, latest), unit);
    return {text: `${series.name}: ${readable(value)}% do total em ${when}${delta ? `, ${changeText(delta)} em 12 meses` : ''}`, date: latest,
      figures: [{label: series.name, value, unit, delta}]};
  }
  // Barra com linha no eixo secundário (concessões e prazo).
  if (bars.length === 1 && chart.series.some(series => series.axis === 1)) {
    const bar = bars[0], line = chart.series.find(series => series.axis === 1), value = at(bar, latest), term = at(line, latest);
    const delta = change(value, yearAgo(bar, latest), unit);
    if (!finite(value)) return null;
    return {text: `${quantity(value, unit)} em ${when}${delta ? ` (${changeText(delta)} em 12 meses)` : ''}${finite(term) ? `; ${line.name.toLowerCase()} de ${readable(term)} ${chart.axes?.[1] || ''}`.trimEnd() : ''}`, date: latest,
      figures: [{label: bar.name, value, unit, delta}, ...(finite(term) ? [{label: line.name, value: term, unit: chart.axes?.[1] || ''}] : [])]};
  }
  // Muitas séries de variação sem total: maior e menor variação.
  if (isGrowthUnit(unit) && /%/.test(unit) && chart.series.length >= 5 && !chart.series.some(series => LEAD.test(series.name))) {
    const ranked = chart.series.map(series => ({series, date: latestDate(series)})).filter(entry => entry.date === latest).map(entry => ({...entry, value: at(entry.series, latest)})).sort((a, b) => b.value - a.value);
    if (ranked.length >= 2) {
      const top = ranked[0], bottom = ranked.at(-1), real = /real/i.test(unit) ? ' real' : '';
      return {text: `${top.value > 0 ? 'Maior alta' : 'Menor queda'}${real}: ${top.series.name} (${quantity(top.value, unit)}); ${bottom.value < 0 ? 'maior queda' : 'menor'}: ${bottom.series.name} (${quantity(bottom.value, unit)}), em 12 meses até ${when}`, date: latest,
        figures: [{label: top.series.name, value: top.value, unit}, {label: bottom.series.name, value: bottom.value, unit}]};
    }
  }
  const series = leadSeries(chart);
  if (!series) return null;
  const date = latestDate(series), value = at(series, date), delta = change(value, yearAgo(series, date), unit);
  const label = chart.series.length > 1 ? `${READING_NAMES[series.name] || series.name}: ` : '';
  if (isGrowthUnit(unit) && !/%/.test(unit)) {
    return {text: `${label}${quantity(value, unit)} em 12 meses até ${monthLabel(date)}`, date, figures: [{label: series.name, value, unit, delta}]};
  }
  if (isGrowthUnit(unit) && /%/.test(unit)) {
    const verb = value > 0 ? 'cresce' : value < 0 ? 'recua' : 'fica estável';
    const real = /real/i.test(unit) ? ' em termos reais' : '';
    return {text: `${label}${verb}${value ? ` ${fmt(Math.abs(value), 1)}%` : ''}${real} em 12 meses até ${monthLabel(date)}`, date,
      figures: [{label: series.name, value, unit, delta}]};
  }
  return {text: `${label}${quantity(value, unit)} em ${monthLabel(date)}${delta ? `, ${changeText(delta)} em 12 meses` : ''}`, date,
    figures: [{label: series.name, value, unit, delta}]};
}
function latestComplete(chart) {
  return chartCategories(chart).filter(isDate).filter(date => finite(stackedTotal(chart, date))).at(-1) || null;
}
function stackedTotalByMonth(chart, month) {
  const date = chartCategories(chart).find(value => value.slice(0, 7) === month);
  return date ? stackedTotal(chart, date) : null;
}

/* ---------- Números-chave de cada assunto ---------- */

// Cada número cita uma série publicada. `sum` soma séries do mesmo gráfico na mesma data.
export const KEY_FIGURES = {
  'sfn:panorama': [{chart: 'credito_estoque-1', sum: true, label: 'Saldo de crédito do SFN'}, {chart: 'credito_estoque-2', series: 'Crédito ampliado', label: 'Crédito ampliado, variação real'}, {chart: 'situacao-0', series: 'Comprometimento total', label: 'Renda das famílias comprometida'}],
  'sfn:concessoes': [{chart: 'concessoes-0', sum: true, label: 'Concessões no mês, com ajuste sazonal'}, {chart: 'concessoes-3', series: 'Consignado', label: 'Consignado'}, {chart: 'concessoes-7', series: 'Crédito imobiliário', label: 'Crédito imobiliário'}],
  'sfn:carteiras': [{chart: 'credito_tomador-1', series: 'PF total', label: 'Carteira PF, variação real'}, {chart: 'credito_tomador-3', series: 'PJ total', label: 'Carteira PJ, variação real'}, {chart: 'credito_controle-0', series: 'SF público', label: 'Participação dos bancos públicos'}],
  'sfn:inadimplencia': [{chart: 'npl_pre_inad-0', series: 'Inad total', label: 'Inadimplência acima de 90 dias'}, {chart: 'npl_pre_inad-0', series: 'Pré-inad total', label: 'Atraso de 15 a 90 dias'}, {chart: 'npl_cobertura-1', series: 'SFN', label: 'Cobertura da carteira inadimplente'}],
  'sfn:juros': [{chart: 'taxas-5', series: 'Taxa PF livre', label: 'Taxa média PF, recursos livres'}, {chart: 'taxas-5', series: 'Taxa PJ livre', label: 'Taxa média PJ, recursos livres'}, {chart: 'taxas-3', series: 'Cartão rotativo', label: 'Cartão rotativo'}],
  'payments:transacoes': [{chart: 'spb-mensal-quantidade', series: 'Pix', label: 'Pix no mês'}, {chart: 'spb-mensal-quantidade', series: 'Boleto', label: 'Boletos no mês'}, {chart: 'spb-participacao-quantidade', series: 'Pix', label: 'Pix nas transações do trimestre'}],
  'payments:cartoes': [{chart: 'spb-cartoes-qtd_cartoes_ativos', series: 'Crédito', label: 'Cartões de crédito ativos'}, {chart: 'spb-desconto', series: 'Crédito', label: 'MDR médio no crédito'}, {chart: 'spb-intercambio', series: 'Crédito', label: 'Intercâmbio médio no crédito'}],
  'payments:canais': [{chart: 'spb-canais-7', series: 'Telefone Celular', label: 'Pix pelo celular no trimestre'}, {chart: 'spb-canais-0', series: 'Telefone Celular', label: 'Boletos e convênios pelo celular'}, {chart: 'spb-canais-8', series: 'ATM', label: 'Saques em ATM'}],
  'payments:terminais': [{chart: 'spb-terminais', series: 'POS', label: 'Terminais POS'}, {chart: 'spb-atm', series: 'Agências e postos de atendimento', label: 'ATMs em agências e postos'}, {chart: 'spb-atm', series: 'Antessalas de autoatendimento', label: 'ATMs em antessalas'}],
};

/** Calcula os números-chave de um assunto a partir dos gráficos originais. */
export function keyFigures(page, topic, charts) {
  const byId = new Map(charts.map(chart => [chart.id, chart]));
  return (KEY_FIGURES[`${page}:${topic}`] || []).map(spec => {
    const chart = byId.get(spec.chart);
    if (!chart) return null;
    const unit = chart.axes?.[0] || chart.unit || '';
    let series, value, before, date, spark;
    if (spec.sum) {
      date = latestComplete(chart);
      value = date ? stackedTotal(chart, date) : null;
      before = date ? stackedTotalByMonth(chart, shiftMonths(date, -12)) : null;
      spark = chartCategories(chart).filter(isDate).map(day => [day, stackedTotal(chart, day)]);
    } else {
      series = chart.series.find(entry => entry.name === spec.series);
      if (!series) return null;
      date = latestDate(series);
      value = date ? at(series, date) : null;
      before = date ? yearAgo(series, date) : null;
      spark = series.data;
    }
    if (!finite(value)) return {label: spec.label, value: null, unit, text: 'N/D', date: null, delta: null, spark: [], chart: spec.chart};
    const delta = change(value, before, unit);
    const recent = date ? spark.filter(point => point[0] >= shiftMonths(date, -60) && point[0] <= date) : [];
    return {label: spec.label, value, unit, text: quantity(value, unit), date, when: monthLabel(date), delta, deltaText: changeText(delta), spark: recent, chart: spec.chart};
  }).filter(Boolean);
}

/* ---------- Recessões (CODACE/FGV) ---------- */

// Datas de pico e vale do Comitê de Datação de Ciclos Econômicos. Fundo de leitura, sem dado numérico.
export const RECESSIONS = Object.freeze([
  Object.freeze({from: '2014-04-01', to: '2016-12-01', label: 'Recessão 2014–2016'}),
  Object.freeze({from: '2020-01-01', to: '2020-06-01', label: 'Recessão 2020'}),
]);
export function recessionsIn(dates) {
  const first = dates[0], last = dates.at(-1);
  if (!isDate(first) || !isDate(last)) return [];
  return RECESSIONS.filter(band => band.to >= first && band.from <= last).map(band => ({...band, from: band.from < first ? first : band.from, to: band.to > last ? last : band.to}));
}

/* ---------- Fonte ---------- */

const SOURCE_NAMES = [[/SCR\.data/, 'SCR.data'], [/SGS/, 'SGS'], [/MPV_DadosAbertos/, 'estatísticas de meios de pagamento'], [/MercadoImobiliario/, 'estatísticas do mercado imobiliário'], [/IF\.?data/i, 'IF.data'], [/COSIF/, 'COSIF']];
/** Uma única menção de fonte para um conjunto de gráficos. */
export function sourceLine(charts) {
  const names = [];
  for (const chart of charts) for (const [pattern, name] of SOURCE_NAMES) if (pattern.test(chart.source || '') && !names.includes(name)) names.push(name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0];
  return list ? `Banco Central do Brasil, ${list}` : 'Banco Central do Brasil';
}
