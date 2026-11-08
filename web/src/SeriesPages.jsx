import React, {useEffect, useId, useMemo, useState} from 'react';
import {ChartPanel, ExportMenu, KeyFigures} from './Chart.jsx';
import {defaultInterval, seriesCollections} from './series-data.js';
import {chartNotes, orderTopic, presentSeriesChart, seriesTopics, topicExtras} from './series-presentation.js';
import {keyFigures} from './editorial.js';

const TITLES = {sfn: 'Estatísticas de crédito', imob: 'Mercado imobiliário', payments: 'Estatísticas de pagamentos'};

export function PeriodFilters({window, setWindow, start, setStart, end, setEnd}) {
  return <>
    <label className="tc-field">Período<select value={window} onChange={event => setWindow(event.target.value)}>
      <option value="12">Últimos 12 meses</option><option value="24">Últimos 24 meses</option><option value="60">Últimos 5 anos</option><option value="all">Série completa</option><option value="interval">Intervalo personalizado</option>
    </select></label>
    {window === 'interval' && <><label className="tc-field">De<input type="month" value={start} onChange={event => setStart(event.target.value)}/></label><label className="tc-field">Até<input type="month" value={end} onChange={event => setEnd(event.target.value)}/></label></>}
  </>;
}

export default function SeriesPages({page, manifest, sfn = [], extra = [], imob = [], uf = 'br', setUf, loading = false, onError, onNavigate}) {
  const [window, setWindow] = useState('60');
  const defaults = useMemo(() => defaultInterval([...sfn, ...extra, ...imob]), [sfn, extra, imob]);
  const [start, setStart] = useState(defaults.start), [end, setEnd] = useState(defaults.end);
  const collections = useMemo(() => seriesCollections({sfn, extra, imob, window, start, end}), [sfn, extra, imob, window, start, end]);
  // A leitura de cada gráfico vem da série completa, para comparar com 12 meses antes em qualquer janela.
  const sources = useMemo(() => new Map([...sfn, ...extra, ...imob].map(chart => [chart.id, chart])), [sfn, extra, imob]);
  const raw = useMemo(() => seriesCollections({sfn, extra, imob, window: 'all'})[page], [sfn, extra, imob, page]);
  const presented = useMemo(() => {
    const charts = collections[page].map(chart => presentSeriesChart(chart, page, sources.get(chart.id)));
    return [...topicExtras(page, raw), ...charts];
  }, [collections, page, sources, raw]);
  const topics = useMemo(() => seriesTopics(page, presented), [page, presented]);
  const figures = useMemo(() => Object.fromEntries(topics.map(topic => [topic.id, keyFigures(page, topic.id, raw)])), [topics, page, raw]);
  const [section, setSection] = useState('');
  const selected = topics.find(topic => topic.id === section) || topics[0];
  useEffect(() => {if (selected && section !== selected.id) setSection(selected.id);}, [section, selected]);
  const ordered = useMemo(() => topics.flatMap(topic => orderTopic(topic.id, presented.filter(chart => chart.topic === topic.id))), [topics, presented]);
  const charts = ordered.filter(chart => chart.topic === selected?.id);
  const title = `${TITLES[page]} · ${selected?.label || ''}`;
  const notes = chartNotes(charts);
  const complete = useMemo(() => {
    if (page === 'payments') return undefined;
    const credit = collections.sfn.map(chart => presentSeriesChart(chart, 'sfn', sources.get(chart.id)));
    const housing = collections.imob.map(chart => presentSeriesChart(chart, 'imob', sources.get(chart.id))).map(chart => ({...chart, topic: 'imob:' + chart.topic, topicLabel: 'Mercado imobiliário · ' + chart.topicLabel}));
    const creditTopics = seriesTopics('sfn', credit), housingTopics = seriesTopics('imob', collections.imob);
    return [...creditTopics.flatMap(topic => orderTopic(topic.id, credit.filter(chart => chart.topic === topic.id))), ...housingTopics.flatMap(topic => housing.filter(chart => chart.topic === 'imob:' + topic.id))];
  }, [page, collections, sources]);
  const creditFigures = useMemo(() => page === 'payments' ? {} : Object.fromEntries(seriesTopics('sfn', seriesCollections({sfn, extra, window: 'all'}).sfn).map(topic => [topic.id, keyFigures('sfn', topic.id, [...sfn, ...extra])])), [page, sfn, extra]);
  const deck = useMemo(() => ({figures: {...creditFigures, ...figures}}), [creditFigures, figures]);
  const loadingHousing = page === 'imob' && loading;
  const id = useId();
  return <>
    <section className="tc-page-header" aria-labelledby={`${id}-heading`}>
      <div className="tc-page-heading-row"><div className="tc-page-title"><h1 id={`${id}-heading`}>{TITLES[page]}</h1></div>
        {page !== 'payments' && <a className="tc-related-link" href={page === 'sfn' ? '?view=imob' : '?view=sfn'} onClick={event => {if (onNavigate && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {event.preventDefault(); onNavigate(page === 'sfn' ? 'imob' : 'sfn');}}}>{page === 'sfn' ? 'Mercado imobiliário' : 'Estatísticas de crédito'}</a>}
      </div>
      <div className="tc-section-controls">
        <label className="tc-field tc-topic-field">Assunto<select value={selected?.id || ''} onChange={event => setSection(event.target.value)}>{topics.map(topic => <option value={topic.id} key={topic.id}>{topic.label}</option>)}</select></label>
        {page === 'imob' && <label className="tc-field">Abrangência<select value={uf} onChange={event => setUf?.(event.target.value)}>{(manifest.ufs || ['br']).map(value => <option key={value} value={value}>{value === 'br' ? 'Brasil' : value.toUpperCase()}</option>)}</select></label>}
        <PeriodFilters {...{window, setWindow, start, setStart, end, setEnd}}/>
        <ExportMenu charts={charts} title={title} allCharts={complete} collection={ordered} collectionTitle={TITLES[page]} deck={deck} disabled={loadingHousing} onError={onError}/>
      </div>
    </section>
    <div className="tc-page-content">
      {window === 'interval' && start && end && start > end && <p className="tc-inline-message" role="alert">A data inicial está depois da final. Ajuste o intervalo para consultar as séries.</p>}
      {!loadingHousing && <KeyFigures figures={figures[selected?.id]}/>}
      {loadingHousing ? <div className="tc-loading" role="status">Carregando dados para {uf === 'br' ? 'Brasil' : uf.toUpperCase()}…</div> : charts.length ? <div className="tc-series-grid">{charts.map((chart, index) => <ChartPanel chart={chart} key={chart.id} showNotes={false} lead={index === 0 && page !== 'imob'}/>)}</div> : <p className="tc-empty">Nenhum gráfico disponível neste assunto.</p>}
      {!loadingHousing && notes.length > 0 && <details className="tc-series-notes"><summary>Notas dos dados</summary><dl>{notes.map(note => <div key={note.text}><dt>{note.charts.join(' · ')}</dt><dd>{note.text}</dd></div>)}</dl></details>}
    </div>
  </>;
}
