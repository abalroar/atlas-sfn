// Combinação de gráficos. Séries de origem entram inteiras (mesmos pontos, mesma unidade, mesmo sinal);
// a combinação escolhe só o gráfico e o eixo em que cada uma aparece. O CSV continua exportando os
// gráficos de origem (csvSources).
import {latestDate, monthLabel, quantity} from './editorial.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const RATIO = 6, MAX_LINES = 6;
const latestAbs = series => {const date = latestDate(series), value = date ? series.data.find(point => point[0] === date)?.[1] : null; return finite(value) ? Math.abs(value) : 0;};
const latestOf = series => {const date = latestDate(series); return date ? {date, value: series.data.find(point => point[0] === date)[1]} : null;};

/**
 * Eixos pela grandeza do último valor: à esquerda, as séries até 6 vezes menores que a maior; à
 * direita, o grupo seguinte na mesma faixa. O que fica abaixo disso, ou registra zero, sai do desenho.
 */
export function splitAxes(series, {ratio = RATIO, max = MAX_LINES} = {}) {
  const ranked = series.filter(entry => latestAbs(entry) > 0).sort((a, b) => latestAbs(b) - latestAbs(a));
  if (!ranked.length) return {left: [], right: [], out: series.slice()};
  const top = latestAbs(ranked[0]), left = ranked.filter(entry => latestAbs(entry) >= top / ratio);
  const rest = ranked.filter(entry => !left.includes(entry)), top2 = rest.length ? latestAbs(rest[0]) : 0;
  let right = rest.filter(entry => latestAbs(entry) >= top2 / ratio);
  const keepLeft = left.slice(0, max), keepRight = right.slice(0, Math.max(0, max - keepLeft.length));
  const inOrder = list => series.filter(entry => list.includes(entry));
  return {left: inOrder(keepLeft), right: inOrder(keepRight), out: series.filter(entry => !keepLeft.includes(entry) && !keepRight.includes(entry))};
}

const RIGHT = ' (dir.)';
const asLine = (series, axis, extra = {}) => ({...series, type: 'line', axis, name: axis === 1 && !series.name.endsWith(RIGHT) ? series.name + RIGHT : series.name, ...extra});

function omittedNote(out, unit) {
  const entries = out.map(series => ({series, last: latestOf(series)})).filter(entry => entry.last);
  if (!entries.length) return '';
  return ` Fora do desenho por terem grandeza muito menor: ${entries.map(({series, last}) => `${series.name} (${last.value === 0 ? 'zero' : quantity(last.value, unit)} em ${monthLabel(last.date)})`).join('; ')}. Os valores estão no CSV.`;
}

/** Um gráfico de origem redistribuído em dois eixos pela grandeza. */
export function autoAxes(chart, options = {}) {
  const unit = chart.unit || chart.axes?.[0] || '';
  const {left, right, out} = splitAxes(chart.series, options);
  return {...chart, combined: true, smallMultiples: false, view: undefined, stacked: false, axes: right.length ? [unit, unit] : [unit],
    series: [...left.map(series => asLine(series, 0)), ...right.map(series => asLine(series, 1, {dash: true}))],
    note: (chart.note || '') + omittedNote(out, unit), csvSources: chart.csvSources || [chart]};
}

/** Junta séries de vários gráficos. `parts`: [{chart, pick?, rename?, axis?, dash?, type?}]. */
export function mergeCharts(id, title, parts, {unit, units, note = '', view, stacked = false} = {}) {
  const present = parts.filter(part => part.chart);
  if (!present.length) return null;
  const series = [];
  for (const part of present) {
    for (const source of part.chart.series) {
      if (part.pick && !part.pick(source)) continue;
      const name = part.rename ? part.rename(source.name, part.chart) : source.name;
      series.push({...source, name, type: part.type || (part.chart.view === 'area-stack' ? 'line' : source.type || 'line'), axis: part.axis || 0, ...(part.dash ? {dash: true} : {}), ...(part.keepColor ? {colorKey: source.name.replace(/ \(dir\.\)$/, '')} : {})});
    }
  }
  if (!series.length) return null;
  const axes = units || [unit || present[0].chart.unit || present[0].chart.axes?.[0] || ''];
  const named = series.map(entry => entry.axis === 1 && !entry.name.endsWith(RIGHT) ? {...entry, name: entry.name + RIGHT} : entry);
  const first = present[0].chart;
  return {id, title, section: first.section, source: [...new Set(present.map(part => part.chart.source))].join(' · '), unit: axes[0], axes: axes.length > 1 ? axes : undefined,
    percent: /%/.test(axes[0]), stacked, view, combined: true, note: [note, ...new Set(present.map(part => part.chart.note).filter(Boolean))].filter(Boolean).join(' '),
    latestPeriod: first.latestPeriod, topic: first.topic, topicLabel: first.topicLabel,
    series: named, csvSources: present.flatMap(part => part.chart.csvSources || [part.chart])};
}

/** Alternância entre gráficos que respondem à mesma pergunta (quantidade/valor, R$/%, PF/PJ). */
export function alternatives(id, title, options) {
  const list = options.filter(option => option.chart);
  if (!list.length) return null;
  if (list.length === 1) return list[0].chart;
  const first = list[0].chart;
  return {...first, id, title: title || first.title, alternatives: list.map(option => ({label: option.label, chart: option.chart})),
    csvSources: list.flatMap(option => option.chart.csvSources || [option.chart])};
}

/** Soma das mesmas categorias em vários gráficos de mesma unidade, data a data (só valores publicados). */
export function sumAcross(id, title, charts, {unit, note} = {}) {
  const names = [...new Set(charts.flatMap(chart => chart.series.map(series => series.name)))];
  const series = names.map(name => {
    const totals = new Map();
    for (const chart of charts) for (const source of chart.series.filter(entry => entry.name === name)) for (const [date, value] of source.data) if (finite(value)) totals.set(date, (totals.get(date) || 0) + value);
    return {name, type: 'line', data: [...totals].sort((a, b) => a[0].localeCompare(b[0]))};
  });
  const first = charts[0];
  return {id, title, section: first.section, source: first.source, unit: unit || first.unit, latestPeriod: first.latestPeriod, note, series, csvSources: charts.flatMap(chart => chart.csvSources || [chart])};
}

const pickChart = (charts, id) => charts.find(chart => chart.id === id) || null;

/* ---------- Combinações por página ---------- */

const MODALITY = {'concessoes-1': 'PJ livre', 'concessoes-2': 'PJ direcionado', 'concessoes-3': 'Consignado', 'concessoes-4': 'Crédito pessoal não consignado', 'concessoes-5': 'Veículos', 'concessoes-6': 'Cartão de crédito', 'concessoes-7': 'Crédito imobiliário'};
const SCR_MODALITY = title => /(?:PF - | · )([^·]+)$/.exec(title || '')?.[1]?.trim() || title;

function creditCombos(charts) {
  const get = id => pickChart(charts, id), out = [];
  const bar = id => ({chart: get(id), pick: series => series.axis !== 1, type: 'line'});
  out.push({sources: ['concessoes-3', 'concessoes-4', 'concessoes-5', 'concessoes-6', 'concessoes-7'], after: 'concessoes-1', chart: mergeCharts('cred-concessoes-pf', 'Concessões PF por modalidade',
    [{...bar('concessoes-6')}, {...bar('concessoes-3'), axis: 1, dash: true}, {...bar('concessoes-4'), axis: 1, dash: true}, {...bar('concessoes-5'), axis: 1, dash: true}, {...bar('concessoes-7'), axis: 1, dash: true}],
    {units: ['R$ bi', 'R$ bi'], note: 'Cartão à esquerda; as demais modalidades, de grandeza cerca de dez vezes menor, à direita.'})});
  out.push({sources: ['concessoes-1', 'concessoes-2'], chart: mergeCharts('cred-concessoes-pj', 'Concessões PJ', [bar('concessoes-1'), {...bar('concessoes-2'), axis: 1, dash: true}], {units: ['R$ bi', 'R$ bi']})});
  const term = id => ({chart: get(id), pick: series => series.axis === 1, rename: () => MODALITY[id]});
  out.push({sources: [], after: 'concessoes-1', chart: mergeCharts('cred-concessoes-prazo', 'Prazo médio das concessões',
    ['concessoes-1', 'concessoes-2', 'concessoes-3', 'concessoes-4', 'concessoes-5', 'concessoes-6'].map(term).concat([{...term('concessoes-7'), axis: 1, dash: true}]), {units: ['meses', 'meses'], note: 'Crédito imobiliário, de prazo muito mais longo, no eixo direito.'})});
  out.push({sources: ['credito_tomador-0', 'credito_tomador-2'], chart: alternatives('cred-tomador', 'Saldo por tomador', [{label: 'R$', chart: get('credito_tomador-0')}, {label: '%', chart: get('credito_tomador-2')}])});
  out.push({sources: ['credito_tomador-1', 'credito_tomador-3'], chart: mergeCharts('cred-tomador-crescimento', 'Crescimento real da carteira PF e PJ', [{chart: get('credito_tomador-1')}, {chart: get('credito_tomador-3')}], {unit: 'Δ YoY real (%)'})});
  out.push({sources: ['credito_produto-2', 'credito_produto-3'], chart: mergeCharts('cred-produtos-variacao', 'Variação real por produto, PF e PJ', [{chart: get('credito_produto-2')}, {chart: get('credito_produto-3')}], {unit: 'Δ YoY real (%)', view: 'dumbbell'})});
  out.push({sources: ['credito_produto-4', 'credito_produto-5'], chart: mergeCharts('cred-cartao-direcionados', 'Crescimento do cartão e dos direcionados', [{chart: get('credito_produto-4')}, {chart: get('credito_produto-5'), dash: true}], {unit: 'Δ YoY real (%)'})});
  out.push({sources: ['credito_empresa-0', 'credito_empresa-1'], chart: alternatives('cred-empresa', 'Carteira PJ por porte', [{label: 'R$', chart: get('credito_empresa-0')}, {label: '%', chart: get('credito_empresa-1')}])});
  const unemployment = get('situacao-1');
  if (unemployment) out.push({sources: ['situacao-1'], chart: {...unemployment, axes: ['%', 'p.p.'], unit: '%', series: unemployment.series.map(series => /Variação/.test(series.name) ? {...series, axis: 1, name: series.name + RIGHT, dash: true} : series), csvSources: [unemployment]}});
  const npl2 = get('npl_pre_inad-2'), npl4 = get('npl_pre_inad-4');
  out.push({sources: ['npl_pre_inad-2', 'npl_pre_inad-4'], chart: mergeCharts('cred-npl-pj', 'Atraso e inadimplência por produto PJ', [
    {chart: npl2, pick: series => !/Desconto/.test(series.name), rename: name => `${name} · 15–90 dias`, dash: true, keepColor: true},
    {chart: npl4, pick: series => !/Desconto/.test(series.name), rename: name => `${name} · > 90 dias`, keepColor: true},
    {chart: npl2, pick: series => /Desconto/.test(series.name), rename: name => `${name.replace(/ \(dir\.\)$/, '')} · 15–90 dias`, axis: 1, dash: true, keepColor: true},
    {chart: npl4, pick: series => /Desconto/.test(series.name), rename: name => `${name.replace(/ \(dir\.\)$/, '')} · > 90 dias`, axis: 1, keepColor: true},
  ], {units: ['% da carteira', '% da carteira'], note: 'Desconto de recebíveis, de taxa menor, no eixo direito. Tracejado: 15 a 90 dias de atraso.'})});
  const scr = ['scr-0', 'scr-1', 'scr-2', 'scr-3', 'scr-4', 'scr-5', 'scr-6'].map(get).filter(Boolean);
  if (scr.length) {
    out.push({sources: scr.map(chart => chart.id), after: 'scr-8', chart: scrHeatmap(scr)});
    out.push({sources: [], after: 'scr-8', chart: mergeCharts('cred-scr-modalidades', 'Inadimplência PF por modalidade, todas as faixas de renda',
      scr.map(chart => ({chart, pick: series => series.name === 'Todos', rename: () => SCR_MODALITY(chart.title)})), {unit: '%'})});
  }
  const pfRate = ['taxas-1', 'taxas-2', 'taxas-3'].map(id => ({chart: get(id), axis: 1, dash: true, pick: series => !(id === 'taxas-2' && series.name === 'Cartão total')}));
  out.push({sources: ['taxas-0', 'taxas-1', 'taxas-2', 'taxas-3'], chart: mergeCharts('cred-taxas-pf', 'Taxa média PF por modalidade', [{chart: get('taxas-0')}, ...pfRate],
    {units: ['% a.a.', '% a.a.'], note: 'Modalidades com garantia à esquerda; sem garantia e cartão, de taxa várias vezes maior, à direita.'})});
  return out;
}

function scrHeatmap(charts) {
  const date = charts.map(chart => chart.series.map(latestDate).filter(Boolean).sort().at(-1)).filter(Boolean).sort().at(-1);
  const columns = charts[0].series.map(series => series.name).filter(name => name !== 'Todos');
  const rows = charts.map(chart => ({id: chart.id, label: SCR_MODALITY(chart.title), values: Object.fromEntries(columns.map(name => [name, chart.series.find(series => series.name === name)?.data.find(point => point[0] === date)?.[1] ?? null]))}));
  const first = charts[0];
  let top = null;
  for (const row of rows) for (const column of columns) {const value = row.values[column]; if (finite(value) && (!top || value > top.value)) top = {row: row.label, column, value};}
  const reading = top ? {text: `Maior taxa: ${top.row.toLowerCase()} na faixa de renda ${top.column.toLowerCase()} (salários mínimos), com ${new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1}).format(top.value)}% em ${monthLabel(date)}`, date} : null;
  return {id: 'cred-scr-faixas', reading, title: 'Inadimplência PF por modalidade e faixa de renda', section: first.section, source: first.source, unit: '%', percent: true, latestPeriod: date,
    view: 'matrix', matrix: {kind: 'rate', date, label: monthLabel(date), unit: '%', head: 'Modalidade', columns, short: Object.fromEntries(columns.map(name => [name, name])), columnNote: 'faixa de renda em salários mínimos', rows},
    note: first.note, series: columns.map(name => ({name, type: 'bar', data: rows.map(row => [row.label, row.values[name]])})), csvSources: charts};
}

function paymentCombos(charts) {
  const get = id => pickChart(charts, id), out = [];
  out.push({sources: ['spb-mensal-quantidade', 'spb-mensal-valor'], chart: alternatives('pay-mensal', 'Transações por mês: quantidade e valor', [{label: 'Quantidade', chart: get('spb-mensal-quantidade')}, {label: 'Valor', chart: get('spb-mensal-valor')}])});
  out.push({sources: ['spb-participacao-quantidade', 'spb-participacao-valor'], chart: alternatives('pay-participacao', 'Participação por instrumento', [{label: 'Quantidade', chart: get('spb-participacao-quantidade')}, {label: 'Valor', chart: get('spb-participacao-valor')}])});
  for (const [id, detail] of [['spb-consolidado-quantidade', 'spb-trimestral-quantidade'], ['spb-consolidado-valor', 'spb-trimestral-valor']]) {
    const chart = get(id);
    if (chart) out.push({sources: [id, detail], chart: {...autoAxes(chart), csvSources: [chart, get(detail)].filter(Boolean), note: autoAxes(chart).note + ' O detalhe por instrumento está na participação e no CSV.'}});
  }
  const fn = (label, measure) => name => `${name} · ${measure}`;
  out.push({sources: ['spb-desconto', 'spb-intercambio'], chart: mergeCharts('pay-tarifas', 'MDR e tarifa de intercâmbio por função', [{chart: get('spb-desconto'), rename: fn('', 'MDR'), keepColor: true}, {chart: get('spb-intercambio'), rename: fn('', 'intercâmbio'), dash: true, keepColor: true}], {unit: '%'})});
  out.push({sources: ['spb-cartoes-qtd_cartoes_emitidos', 'spb-cartoes-qtd_cartoes_ativos'], chart: mergeCharts('pay-cartoes-base', 'Cartões emitidos e ativos', [{chart: get('spb-cartoes-qtd_cartoes_emitidos'), rename: fn('', 'emitidos'), keepColor: true}, {chart: get('spb-cartoes-qtd_cartoes_ativos'), rename: fn('', 'ativos'), dash: true, keepColor: true}], {unit: 'unidades'})});
  for (const [scope, label] of [['nacionais', 'nacionais'], ['internacionais', 'internacionais']]) {
    out.push({sources: [`spb-cartoes-qtd_transacoes_${scope}`, `spb-cartoes-valor_transacoes_${scope}`], chart: mergeCharts(`pay-cartoes-${scope}`, `Transações ${label} com cartão: quantidade e valor`,
      [{chart: get(`spb-cartoes-qtd_transacoes_${scope}`), rename: fn('', 'quantidade'), keepColor: true}, {chart: get(`spb-cartoes-valor_transacoes_${scope}`), rename: fn('', 'valor'), axis: 1, dash: true, keepColor: true}], {units: ['transações', 'R$']})});
  }
  const channels = charts.filter(chart => /^spb-canais-\d+$/.test(chart.id));
  if (channels.length) {
    const total = sumAcross('pay-canais-total', 'Transações por canal, todos os produtos', channels, {note: 'Soma, trimestre a trimestre, das transações publicadas para cada canal nos produtos. Canal sem registro num produto não entra na soma desse produto.'});
    out.push({sources: channels.map(chart => chart.id), chart: autoAxes(total)});
  }
  const services = get('spb-servicos');
  if (services) out.push({sources: ['spb-servicos'], chart: autoAxes(services)});
  const terminals = get('spb-terminais');
  if (terminals) out.push({sources: ['spb-terminais'], chart: autoAxes(terminals)});
  return out;
}

function housingCombos(charts) {
  const get = id => pickChart(charts, id), out = [];
  const pfpj = (id, title, base) => out.push({sources: [`${base}_pf`, `${base}_pj`], chart: mergeCharts(id, title, [{chart: get(`${base}_pf`), rename: name => `${name} · PF`, keepColor: true}, {chart: get(`${base}_pj`), rename: name => `${name} · PJ`, dash: true, keepColor: true}])});
  const toggle = (id, base, title) => out.push({sources: [`${base}_pf`, `${base}_pj`], chart: alternatives(id, title, [{label: 'PF', chart: get(`${base}_pf`)}, {label: 'PJ', chart: get(`${base}_pj`)}])});
  const stackWithTotal = (id, title, base, unit) => {
    const pf = get(`${base}_pf`), pj = get(`${base}_pj`);
    if (!pf) return;
    const total = pj ? sumAcross(`${base}_pj_total`, '', [{...pj, series: pj.series.map(series => ({...series, name: 'PJ, soma das modalidades'}))}], {unit}) : null;
    out.push({sources: [`${base}_pf`, `${base}_pj`], chart: mergeCharts(id, title, [{chart: pf, rename: name => `${name} · PF`}, ...(total ? [{chart: {...total, csvSources: [pj]}, axis: 1, type: 'line', dash: true}] : [])], {units: total ? [unit, unit] : [unit], stacked: true, note: total ? 'PF empilhado por modalidade, à esquerda; PJ como soma das modalidades publicadas, à direita.' : ''})});
  };
  stackWithTotal('imob-valor', 'Valor contratado, PF e PJ', 'contratacao_valor', 'R$ milhões');
  toggle('imob-indexador-contratacao', 'contratacao_indexador', 'Indexadores nas contratações');
  pfpj('imob-taxa', 'Taxa de contratação, PF e PJ', 'contratacao_taxa');
  stackWithTotal('imob-carteira', 'Carteira de crédito imobiliário, PF e PJ', 'estoque_carteira', 'R$ bilhões');
  toggle('imob-indexador-carteira', 'estoque_indexador', 'Indexadores na carteira');
  toggle('imob-risco', 'estoque_risco', 'Risco da operação');
  pfpj('imob-inadimplencia', 'Inadimplência, PF e PJ', 'estoque_inadimplencia');
  toggle('imob-problematicos', 'estoque_problematico', 'Ativos problemáticos');
  out.push({sources: ['imoveis_tipo', 'imoveis_dormitorio', 'imoveis_implantacao', 'imoveis_garantia'], chart: alternatives('imob-perfil', 'Perfil dos imóveis financiados',
    [['Tipo', 'imoveis_tipo'], ['Dormitórios', 'imoveis_dormitorio'], ['Implantação', 'imoveis_implantacao'], ['Garantia', 'imoveis_garantia']].map(([label, id]) => ({label, chart: get(id)})))});
  out.push({sources: ['imoveis_area', 'imoveis_valor'], chart: mergeCharts('imob-area-valor', 'Área e valor dos imóveis', [{chart: get('imoveis_area'), rename: name => `Área ${name.toLowerCase()}`}, {chart: get('imoveis_valor'), rename: name => `Valor de ${name.toLowerCase()}`, axis: 1, dash: true}], {units: ['m²', 'R$ mil']})});
  return out;
}

const COMBOS = {sfn: creditCombos, payments: paymentCombos, imob: housingCombos};

/**
 * Aplica as combinações a uma lista ordenada de gráficos. Cada combinado ocupa o lugar da primeira
 * fonte (ou de `after`); as fontes saem da lista. Gráficos sem combinação seguem como estão.
 */
export function combineCharts(page, charts) {
  const combos = (COMBOS[page]?.(charts) || []).filter(entry => entry.chart);
  const consumed = new Set(combos.flatMap(entry => entry.sources));
  const anchor = entry => (entry.after && charts.some(chart => chart.id === entry.after) ? entry.after : null) || entry.sources.find(id => charts.some(chart => chart.id === id)) || entry.after;
  const result = [], placed = new Set();
  for (const chart of charts) {
    for (const entry of combos) if (!placed.has(entry) && (anchor(entry) === chart.id)) {result.push(entry.chart); placed.add(entry);}
    if (!consumed.has(chart.id)) result.push(chart);
  }
  return result;
}
