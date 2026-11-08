import React, {useEffect, useId, useMemo, useState} from 'react';
import {ChartPanel, ExportMenu, KeyFigures, panelWide} from './Chart.jsx';
import {defaultInterval, seriesCollections} from './series-data.js';
import {chartNotes, orderTopic, presentSeriesChart, seriesTopics, topicExtras} from './series-presentation.js';
import {chartReading, keyFigures, seriesColors, sourceLine} from './editorial.js';
import {combineCharts} from './chart-combinations.js';
import {tabNavigation} from './tab-navigation.js';

const TITLES = {sfn: 'Estatísticas de crédito', payments: 'Estatísticas de pagamentos'};

export function PeriodFilters({window, setWindow, start, setStart, end, setEnd}) {
  return <>
    <label className="tc-field">Período<select value={window} onChange={event => setWindow(event.target.value)}>
      <option value="12">Últimos 12 meses</option><option value="24">Últimos 24 meses</option><option value="60">Últimos 5 anos</option><option value="all">Série completa</option><option value="interval">Intervalo personalizado</option>
    </select></label>
    {window === 'interval' && <><label className="tc-field">De<input type="month" value={start} onChange={event => setStart(event.target.value)}/></label><label className="tc-field">Até<input type="month" value={end} onChange={event => setEnd(event.target.value)}/></label></>}
  </>;
}

// O mercado imobiliário é um assunto de Estatísticas de crédito; ?view=imob abre direto nele.
const HOUSING = 'imob';
const housingTopic = id => id === HOUSING;

// Gráficos combinados ganham cores e leitura; a leitura usa a combinação feita sobre as séries completas.
function decorate(chart, full) {
  if (chart.alternatives) return {...chart, alternatives: chart.alternatives.map((option, index) => ({...option, chart: decorate(option.chart, full?.alternatives?.[index]?.chart)}))};
  if (!chart.combined) return chart;
  return {...chart, colors: seriesColors(chart, 'web'), reading: chart.reading && chart.view === 'matrix' ? chart.reading : chartReading(full || chart)};
}
function combineTopic(page, topic, charts, fullCharts) {
  const full = new Map(combineCharts(page, fullCharts).map(chart => [chart.id, chart]));
  return combineCharts(page, charts).map(chart => ({...decorate(chart, full.get(chart.id)), topic: topic.id, topicLabel: topic.label}));
}

export default function SeriesPages({page: requested, manifest, sfn = [], extra = [], imob = [], uf = 'br', setUf, loading = false, housingError = '', onHousingRetry, onError}) {
  const page = requested === 'imob' ? 'sfn' : requested;
  const [window, setWindow] = useState('60');
  const defaults = useMemo(() => defaultInterval([...sfn, ...extra, ...imob]), [sfn, extra, imob]);
  const [start, setStart] = useState(defaults.start), [end, setEnd] = useState(defaults.end);
  const collections = useMemo(() => seriesCollections({sfn, extra, imob, window, start, end}), [sfn, extra, imob, window, start, end]);
  // A leitura de cada gráfico vem da série completa, para comparar com 12 meses antes em qualquer janela.
  const sources = useMemo(() => new Map([...sfn, ...extra, ...imob].map(chart => [chart.id, chart])), [sfn, extra, imob]);
  const raw = useMemo(() => seriesCollections({sfn, extra, imob, window: 'all'})[page], [sfn, extra, imob, page]);
  const presented = useMemo(() => {
    const charts = collections[page].map(chart => presentSeriesChart(chart, page, sources.get(chart.id)));
    const housing = page === 'sfn' ? collections.imob.map(chart => ({...presentSeriesChart(chart, 'imob', sources.get(chart.id)), topic: HOUSING, topicLabel: 'Mercado imobiliário'})) : [];
    return [...topicExtras(page, raw), ...charts, ...housing];
  }, [collections, page, sources, raw]);
  const topics = useMemo(() => {
    const main = seriesTopics(page, presented.filter(chart => !housingTopic(chart.topic)));
    return page === 'sfn' ? [...main, {id: HOUSING, label: 'Mercado imobiliário'}] : main;
  }, [page, presented, collections.imob]);
  const figures = useMemo(() => Object.fromEntries(topics.map(topic => [topic.id, housingTopic(topic.id) ? [] : keyFigures(page, topic.id, raw)])), [topics, page, raw]);
  const [section, setSection] = useState(requested === 'imob' ? HOUSING : '');
  const selected = topics.find(topic => topic.id === section) || topics[0];
  useEffect(() => {if (selected && section !== selected.id) setSection(selected.id);}, [section, selected]);
  const fullPresented = useMemo(() => {
    const charts = raw.map(chart => presentSeriesChart(chart, page));
    const housing = page === 'sfn' ? seriesCollections({sfn, extra, imob, window: 'all'}).imob.map(chart => ({...presentSeriesChart(chart, 'imob'), topic: HOUSING})) : [];
    return [...charts, ...housing];
  }, [raw, page, sfn, extra, imob]);
  const ordered = useMemo(() => topics.flatMap(topic => {
    const list = orderTopic(topic.id, presented.filter(chart => chart.topic === topic.id));
    const combos = housingTopic(topic.id) ? 'imob' : page;
    return combineTopic(combos, topic, list, fullPresented.filter(chart => chart.topic === topic.id));
  }), [topics, presented, fullPresented, page]);
  const charts = ordered.filter(chart => chart.topic === selected?.id);
  const inHousing = housingTopic(selected?.id);
  const quotedIds = new Set((figures[selected?.id] || []).map(figure => figure.chart));
  const quoted = chart => quotedIds.has(chart.id) || (chart.csvSources || []).some(source => quotedIds.has(source.id));
  // Um painel de meia largura sem par na linha ocupa a largura toda.
  const alone = useMemo(() => {
    const result = new Set();let run = [];
    const flush = () => {if (run.length % 2) result.add(run.at(-1).id); run = [];};
    charts.forEach((chart, index) => {if ((index === 0 && !inHousing) || panelWide(chart)) flush(); else run.push(chart);});
    flush();
    return result;
  }, [charts, inHousing]);
  const title = `${TITLES[page]} · ${selected?.label || ''}`;
  const notes = chartNotes(charts);
  const deck = useMemo(() => ({figures}), [figures]);
  const loadingHousing = inHousing && loading;
  const id = useId();
  return <>
    <section className="tc-page-header" aria-labelledby={`${id}-heading`}>
      <div className="tc-page-heading-row"><div className="tc-page-title"><h1 id={`${id}-heading`}>{TITLES[page]}</h1></div></div>
      <div className="tc-topic-tabs" role="tablist" aria-label="Assunto">{topics.map(topic => <button type="button" role="tab" key={topic.id} id={`${id}-tab-${topic.id}`} aria-selected={topic.id === selected?.id} aria-controls={`${id}-panel`} tabIndex={topic.id === selected?.id ? 0 : -1} onKeyDown={tabNavigation} onClick={() => setSection(topic.id)}>{topic.label}</button>)}</div>
      <div className="tc-section-controls">
        {inHousing && <label className="tc-field">Abrangência<select value={uf} onChange={event => setUf?.(event.target.value)}>{(manifest.ufs || ['br']).map(value => <option key={value} value={value}>{value === 'br' ? 'Brasil' : value.toUpperCase()}</option>)}</select></label>}
        <PeriodFilters {...{window, setWindow, start, setStart, end, setEnd}}/>
        <ExportMenu charts={charts} title={title} collection={ordered} collectionTitle={TITLES[page]} deck={deck} disabled={loadingHousing} onError={onError}/>
      </div>
    </section>
    <div className="tc-page-content" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${selected?.id}`}>
      {window === 'interval' && start && end && start > end && <p className="tc-inline-message" role="alert">A data inicial está depois da final. Ajuste o intervalo para consultar as séries.</p>}
      {inHousing && housingError && <div className="tc-app-error" role="alert"><span>{housingError}</span>{onHousingRetry && <button type="button" onClick={onHousingRetry}>Tentar novamente</button>}</div>}
      {!loadingHousing && <KeyFigures figures={figures[selected?.id]}/>}
      {loadingHousing ? <div className="tc-loading" role="status">Carregando dados para {uf === 'br' ? 'Brasil' : uf.toUpperCase()}…</div> : charts.length ? <div className="tc-series-grid">{charts.map((chart, index) => <ChartPanel chart={chart} key={chart.id} showNotes={false} lead={index === 0 && !inHousing} stretch={alone.has(chart.id)} quiet={index === 0 && quoted(chart)}/>)}</div> : <p className="tc-empty">Nenhum gráfico disponível neste assunto.</p>}
      {!loadingHousing && charts.length > 0 && <footer className="tc-series-sources">
        <p>Fonte: {sourceLine(charts)}. Unidade e período em cada gráfico; N/D indica ausência de dado publicado.</p>
        {notes.length > 0 && <details className="tc-series-notes"><summary>Notas dos dados</summary><dl>{notes.map(note => <div key={note.text}><dt>{note.charts.join(' · ')}</dt><dd>{note.text}</dd></div>)}</dl></details>}
      </footer>}
    </div>
  </>;
}
