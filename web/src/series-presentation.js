// Organização editorial. As séries, unidades, fontes e competências permanecem nas bases originais;
// esta camada escolhe títulos, ordem, forma de leitura e cores.
import {chartReading, monthLabel, retiredSeries, seriesColors} from './editorial.js';
import {channelMatrixChart, isUfChart} from './chart-views.js';

const TOPICS = {
  sfn: [['panorama','Panorama'],['concessoes','Concessões'],['carteiras','Carteiras'],['inadimplencia','Inadimplência'],['juros','Juros e spread']],
  imob: [['contratacao','Contratação'],['carteira','Carteira'],['imoveis','Imóveis']],
  payments: [['transacoes','Transações'],['cartoes','Cartões e tarifas'],['canais','Canais de atendimento'],['terminais','Terminais']],
};
export const topicLabel = (page, id) => (TOPICS[page] || []).find(([key]) => key === id)?.[1] || String(id).replace(/^other:/, '');

export function topicForChart(page, chart) {
  const section = chart.section || '';
  if (page === 'sfn') {
    if (section === 'Concessões') return 'concessoes';
    if (section.includes('Estoque de Crédito Total') || section === 'Situação dos Agentes') return 'panorama';
    if (section.startsWith('Crédito SFN')) return 'carteiras';
    if (/^(Inadimplência|SCR)/.test(section)) return 'inadimplencia';
    if (section === 'Taxas de Juros e Spread') return 'juros';
  }
  if (page === 'imob') {
    if (section.startsWith('Contratação')) return 'contratacao';
    if (section.startsWith('Estoque')) return 'carteira';
    if (section === 'Imóveis') return 'imoveis';
  }
  if (page === 'payments') {
    if (/^spb-(mensal|trimestral|participacao|consolidado)-/.test(chart.id)) return 'transacoes';
    if (/^spb-(cartoes|intercambio|desconto)/.test(chart.id)) return 'cartoes';
    if (/^spb-(servicos|canais)/.test(chart.id)) return 'canais';
    if (/^spb-(atm|terminais)/.test(chart.id)) return 'terminais';
  }
  return 'other:' + section;
}

export function seriesTopics(page, charts) {
  const present = new Map(charts.map(chart => [topicForChart(page, chart), chart.section]));
  const known = TOPICS[page] || [];
  return [...known.filter(([id]) => present.has(id)).map(([id,label]) => ({id,label})),
    ...[...present].filter(([id]) => !known.some(([key]) => key === id)).map(([id,label]) => ({id,label}))];
}

const TITLES = {
  'concessoes-0': 'Concessões com ajuste sazonal',
  'credito_estoque-0': 'Composição do crédito ampliado',
  'credito_estoque-1': 'Saldo de crédito do SFN',
  'credito_estoque-2': 'Crescimento do crédito ampliado',
  'credito_tomador-0': 'Saldo por tomador',
  'credito_tomador-2': 'Participação por tomador',
  'credito_produto-0': 'Composição da carteira PF',
  'credito_produto-1': 'Composição da carteira PJ',
  'credito_produto-2': 'Variação real por produto PF',
  'credito_produto-3': 'Variação real por produto PJ',
  'credito_empresa-2': 'Crescimento por tipo de empresa',
  'credito_controle-0': 'Participação por controle',
  'credito_controle-1': 'Crescimento por controle',
  'situacao-1': 'Desocupação e retomada do emprego',
  'npl_pre_inad-0': 'Pré-inadimplência (15–90 dias) e inadimplência (> 90 dias)',
  'npl_pre_inad-1': 'Pré-inadimplência por produto PF',
  'npl_pre_inad-3': 'Inadimplência por produto PF',
  'taxas-6': 'Variação da taxa média e do spread',
  'scr-7': 'Inadimplência PF no cartão de crédito, por UF',
  'scr-8': 'Inadimplência PF no cartão de crédito, por região',
  'spb-mensal-quantidade': 'Transações por mês',
  'spb-mensal-valor': 'Valor transacionado por mês',
  'spb-trimestral-quantidade': 'Transações por trimestre',
  'spb-trimestral-valor': 'Valor transacionado por trimestre',
  'spb-participacao-quantidade': 'Participação nas transações',
  'spb-participacao-valor': 'Participação no valor transacionado',
  'spb-consolidado-quantidade': 'Transações por grupo de instrumentos',
  'spb-consolidado-valor': 'Valor por grupo de instrumentos',
  'spb-intercambio': 'Tarifa de intercâmbio',
  'spb-desconto': 'Taxa de desconto (MDR)',
  'spb-cartoes-qtd_cartoes_emitidos': 'Cartões emitidos',
  'spb-cartoes-qtd_cartoes_ativos': 'Cartões ativos',
};
const scrTitle = title => title.replace(/^Inad \(> 90 d\) - PF - /, 'Inadimplência PF por faixa de renda · ');

// Ordem de leitura dentro do assunto: o gráfico-guia primeiro, a geografia logo depois.
const FIRST = {panorama: ['credito_estoque-1'], carteiras: ['credito_tomador-0'], juros: ['taxas-5'], inadimplencia: ['npl_pre_inad-0', 'scr-7', 'scr-8'], canais: ['spb-canais-matriz'], transacoes: ['spb-mensal-quantidade', 'spb-participacao-quantidade']};
export function orderTopic(topic, charts) {
  const first = FIRST[topic] || [];
  return [...first.map(id => charts.find(chart => chart.id === id)).filter(Boolean), ...charts.filter(chart => !first.includes(chart.id))];
}

function retiredNote(chart) {
  const retired = chart.series.map(retiredSeries).filter(Boolean);
  if (!retired.length) return '';
  const names = retired.map(entry => entry.name), last = retired.map(entry => entry.last).sort().at(-1);
  return ` ${names.join(' e ')} ${names.length > 1 ? 'registram' : 'registra'} zero depois de ${monthLabel(last)}; os painéis ${names.length > 1 ? 'os omitem' : 'o omitem'} e a tabela e o CSV ${names.length > 1 ? 'os mantêm' : 'o mantêm'}.`;
}

export function conciseChartNote(chart) {
  const id = chart.id || '';
  if (id.startsWith('scr-')) return 'Saldo inadimplente sobre a carteira ativa, agregados antes da divisão. Modalidades seguem o de-para BCB, sujeito a quebras de série.';
  if (/^spb-(mensal|trimestral)-/.test(id)) return 'A série mensal exclui cartões. A trimestral inclui todos os instrumentos publicados pelo BCB.' + retiredNote(chart);
  if (id.startsWith('spb-participacao-')) return 'Participação no total de instrumentos de cada trimestre; o denominador inclui todos os instrumentos publicados. A comparação mostra o trimestre mais recente e o mesmo trimestre do ano anterior.' + retiredNote(chart);
  if (id.startsWith('spb-consolidado-')) return 'Cartões: crédito, débito e pré-pago. Cobranças: boleto, convênios e débito direto.';
  if (['spb-intercambio','spb-desconto'].includes(id)) return 'Média simples das taxas de cada combinação publicada, sem ponderação pelo volume.';
  if (id === 'spb-servicos') return 'Quantidade publicada convertida em milhões de transações.';
  if (id.startsWith('spb-canais-')) return 'Soma por trimestre e canal dentro do produto, em milhões de transações. Categorias de acesso ATM preservadas.' + retiredNote(chart);
  if (id.startsWith('spb-cartoes-')) return 'Soma por função e trimestre. Contagens de cartões ou transações, sem identificar pessoas únicas.';
  if (id === 'spb-atm') return 'Soma dos terminais publicados por localização, UF, função e compartilhamento.';
  if (id === 'spb-terminais') return 'Soma por trimestre nas UFs. POS compartilhados e POS chip são subconjuntos do total.';
  if (/^credito_produto-[23]$|^npl_pre_inad-[13]$/.test(id)) return 'A comparação mostra o mês mais recente e o mesmo mês do ano anterior; o botão Série abre o histórico completo.';
  return chart.note || '';
}

// As sete curvas de renda do SCR diferem só pela modalidade: ela abre a leitura.
function scrReading(chart, reading) {
  const modality = /^Inad \(> 90 d\) - PF - (.+)$/.exec(chart.title)?.[1];
  return modality && reading ? {...reading, text: reading.text.replace(/^Todas as faixas de renda:/, `${modality}, todas as faixas de renda:`)} : reading;
}

/** Forma de leitura escolhida pela estrutura do gráfico; os dados seguem iguais. */
export function chartView(chart, page) {
  if (page === 'imob') return undefined;
  if (isUfChart(chart)) return 'tiles';
  if (/^spb-mensal-/.test(chart.id)) return 'area-stack';
  if (chart.stacked && chart.percent && chart.series.every(series => series.type === 'bar')) return 'area-share';
  const bars = chart.series.filter(series => series.type === 'bar' && !series.axis), right = chart.series.filter(series => series.axis === 1);
  if (bars.length === 1 && right.length === 1 && chart.series.length === 2) return 'split';
  if (/^credito_produto-[23]$|^npl_pre_inad-[13]$|^spb-participacao-/.test(chart.id)) return 'dumbbell';
  return undefined;
}

/**
 * `source` é o gráfico sem recorte de período: a leitura compara com 12 meses antes mesmo quando a
 * janela exibida é curta.
 */
export function presentSeriesChart(chart, page, source = chart) {
  let title = TITLES[chart.id] || scrTitle(chart.title);
  if (page === 'imob' && / · P[FJ]$/.test(chart.section || '')) title += ' · ' + chart.section.split(' · ').at(-1);
  const view = chartView(chart, page);
  const visible = chart.series.filter(series => !retiredSeries(series)).length;
  return {...chart, title, note: conciseChartNote(chart), view, topic: topicForChart(page, chart), topicLabel: topicLabel(page, topicForChart(page, chart)),
    reading: chart.reading || scrReading(chart, chartReading(source)), colors: seriesColors(chart, 'web'),
    smallMultiples: page === 'payments' && !view && visible >= 6 && !chart.percent && !chart.stacked};
}

/** Gráficos sintéticos do assunto (hoje, a matriz de canais), calculados das séries originais. */
export function topicExtras(page, charts) {
  if (page !== 'payments') return [];
  const matrix = channelMatrixChart(charts);
  return matrix ? [{...matrix, topic: 'canais', topicLabel: topicLabel('payments', 'canais'), colors: []}] : [];
}

export function chartNotes(charts) {
  const notes = new Map();
  for (const chart of charts) {
    if (!chart.note) continue;
    const entry = notes.get(chart.note) || {text: chart.note, charts: []};
    entry.charts.push(chart.title);
    notes.set(chart.note, entry);
  }
  return [...notes.values()];
}
