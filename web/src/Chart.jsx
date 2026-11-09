import React, {useEffect, useMemo, useRef, useState} from 'react';
import * as echarts from 'echarts';
import {axisUnits, chartOption, csvDownload, dateLabel, periodOf, seriesUnit, seriesAxis} from './data.js';
import {exportPptx} from './export.js';
import {chartLabel, chartTick, chartValue, showInnerLabel} from './chart-format.js';
import {WEB_CHART_COLORS} from './chart-palette.js';
import {displayScale, monthLabel, quantity, readable, recessionsIn, seriesColors} from './editorial.js';
import {bandCategories, dateCategories, dumbbellRows, narrowSides, panelWide, ufTiles} from './chart-views.js';
export {panelWide};
import SmallMultiples from './SmallMultiples.jsx';
import {useNarrow} from './use-narrow.js';

export {WEB_CHART_COLORS};
export const plainText = value => String(value ?? '').replace(/<[^>]*>/g, '').replaceAll('&amp;', '&');
const FONT = 'Hanken Grotesk Variable, Hanken Grotesk, Arial, sans-serif';
const INK = '#213e50', MUTED = '#506a76', RULE = '#e0e8eb';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const isLevelUnit = unit => !/%|Δ|variação|meses|p\.p\./i.test(unit || '');

/** Unidade como aparece no gráfico: a escala de exibição troca só o rótulo. */
export function shownUnits(chart) {
  return axisUnits(chart).map((unit, axis) => displayScale(unit, chart.series.filter(series => seriesAxis(chart, series) === axis).flatMap(series => series.data.map(point => point[1]))).unit);
}
const unitCaption = chart => chart.view === 'matrix' ? (chart.matrix.kind === 'rate' ? `% da carteira · ${chart.matrix.label}` : `% do total de transações do produto · ${chart.matrix.label}`) : chart.view === 'dumbbell' ? `${shownUnits(chart)[0]} · ${dumbbellRows(chart).label} contra 12 meses antes` : [...new Set(shownUnits(chart))].join(' / ');

export default function Chart(props) {
  const {chart} = props, narrow = useNarrow();
  // No celular, halteres e matrizes viram listas: o nome em cima, o dado embaixo, na largura toda.
  if (narrow && chart.view === 'matrix') return chart.matrix.kind === 'rate' ? <RateList chart={chart}/> : <ShareList chart={chart}/>;
  if (narrow && chart.view === 'dumbbell' && !props.compact) return <DumbbellList chart={chart}/>;
  if (chart.view === 'matrix') return <ChannelMatrix chart={chart}/>;
  if (chart.view === 'tiles' && !props.compact) return <UfTiles chart={chart}/>;
  if (chart.smallMultiples) return <SmallMultiples chart={chart}/>;
  return <StandardChart {...props}/>;
}

/* ---------- Opções ECharts ---------- */

function axisLabel(chart, axis) {
  const values = chart.series.filter(series => seriesAxis(chart, series) === axis).flatMap(series => series.data.map(point => point[1]));
  const scale = displayScale(axisUnits(chart)[axis], values);
  return {scale, formatter: value => chartTick(value / scale.factor)};
}

const escapeHtml = text => String(text).replace(/[&<>"]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[char]);
/** Dica com a data por extenso (jan/2026) e os valores na unidade de cada série. */
function axisTooltip(unitOf) {
  return params => {
    const list = (Array.isArray(params) ? params : [params]).filter(item => item.seriesType !== 'custom' && item.value != null && item.value !== '');
    if (!list.length) return '';
    const head = monthLabel(String(list[0].axisValue ?? list[0].name ?? ''));
    return `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(head)}</div>` + list.map(item => `<div style="display:flex;justify-content:space-between;gap:18px"><span>${item.marker}${escapeHtml(item.seriesName)}</span><strong>${escapeHtml(quantity(Number(item.value), unitOf(item)))}</strong></div>`).join('');
  };
}
/** Legenda sem paginação: quebra em linhas e o gráfico cede a altura necessária. */
function wrappedLegend(option, names, width) {
  const usable = Math.max(240, (width || 600) - 16), widths = names.map(name => 26 + String(name).length * 6.3);
  let rows = 1, line = 0;
  for (const item of widths) {if (line + item > usable && line > 0) {rows += 1; line = 0;} line += item;}
  option.legend = {...option.legend, type: 'plain', left: 0, right: 0, bottom: 0, itemGap: 12};
  option.grid = {...option.grid, bottom: 30 + rows * 19};
}

function standardOption(chart, {colors, compact, showLegend, width, endLabels = true}) {
  const option = chartOption(chart);
  option.color = colors;
  option.textStyle = {...option.textStyle, color: INK, fontSize: 11};
  option.legend = {...option.legend, show: showLegend, pageIconColor: INK, pageIconInactiveColor: '#b8c4c6', pageIconSize: 10, pageTextStyle: {color: MUTED, fontSize: 11}, textStyle: {...option.legend.textStyle, color: MUTED, fontFamily: FONT}};
  option.tooltip = {...option.tooltip, backgroundColor: '#fff', borderColor: '#bdced3', textStyle: {color: INK, fontFamily: FONT, fontSize: 12}, formatter: axisTooltip(item => seriesUnit(chart, chart.series[item.seriesIndex] || chart.series[0]))};
  if (!compact && showLegend) wrappedLegend(option, chart.series.map(series => series.name), width);
  option.xAxis = {...option.xAxis, axisLabel: {...option.xAxis.axisLabel, color: MUTED, fontSize: 11, showMinLabel: true, showMaxLabel: true}, axisLine: {lineStyle: {color: '#ccdadd'}}};
  const shown = shownUnits(chart);
  option.yAxis = option.yAxis.map((axis, index) => {
    const values = chart.series.filter(series => seriesAxis(chart, series) === index).flatMap(series => series.data.map(point => point[1])).filter(finite);
    const bars = chart.series.some(series => series.type === 'bar' && seriesAxis(chart, series) === index);
    // Volumes começam no zero; taxas e variações seguem a escala dos dados.
    const zeroBase = bars || (isLevelUnit(axisUnits(chart)[index]) && values.length && values.every(value => value >= 0));
    const {formatter} = axisLabel(chart, index);
    return {...axis, name: shown[index], scale: zeroBase ? false : axis.scale, nameTextStyle: {...axis.nameTextStyle, color: MUTED}, axisLabel: {...axis.axisLabel, color: MUTED, fontSize: 11, formatter}, splitLine: {...axis.splitLine, lineStyle: {color: RULE}}};
  });
  option.series = option.series.map((series, index) => ({...series, itemStyle: {color: colors[index % colors.length]}, label: {...series.label, show: false},
    tooltip: {...series.tooltip, valueFormatter: value => quantity(value, seriesUnit(chart, chart.series[index]))},
    ...(series.type === 'line' ? {lineStyle: {...series.lineStyle, width: chart.series.length < 4 ? 2.6 : 2, color: colors[index % colors.length], type: chart.series[index].dash || chart.series[index].name === 'CDI' ? [5, 3] : 'solid'}} : {})}));
  // Rótulo direto no fim da linha quando há poucas séries e espaço.
  const dates = dateCategories(chart), lines = chart.series.every(series => (series.type || 'line') === 'line');
  const names = chart.series.map(series => series.name);
  if (endLabels && !compact && lines && dates.length && axisUnits(chart).length === 1 && chart.series.length > 1 && chart.series.length <= 5 && width >= 520 && Math.max(...names.map(name => name.length)) <= 26) {
    option.legend = {...option.legend, show: false};
    option.grid = {...option.grid, bottom: 32, right: Math.min(190, 18 + 6.4 * Math.max(...names.map(name => name.length)))};
    option.series = option.series.map((series, index) => ({...series, endLabel: {show: true, formatter: '{a}', color: colors[index % colors.length], fontFamily: FONT, fontSize: 11, fontWeight: 500, distance: 6}, labelLayout: {moveOverlap: 'shiftY'}}));
  }
  // Faixas de recessão (CODACE/FGV) ao fundo de séries mensais e trimestrais.
  const bands = dates.length ? bandCategories(recessionsIn(dates), dates) : [];
  if (bands.length && option.series[0]) option.series[0] = {...option.series[0], markArea: {silent: true, itemStyle: {color: 'rgba(80,106,118,.09)'}, label: {show: true, position: 'insideTop', color: MUTED, fontSize: 10, fontFamily: FONT, formatter: 'recessão'}, data: bands.map(band => [{xAxis: band.start}, {xAxis: band.end}])}};
  // Celular: menos margem, fonte menor e sem o nome da unidade no eixo (ela está sob o título).
  if (!compact && width && width < 520) {
    option.grid = {...option.grid, left: 42, right: option.yAxis.length > 1 ? 40 : 10, top: 12};
    option.yAxis = option.yAxis.map(axis => ({...axis, name: '', axisLabel: {...axis.axisLabel, fontSize: 10}}));
    option.xAxis = {...option.xAxis, axisLabel: {...option.xAxis.axisLabel, fontSize: 10}};
    option.legend = {...option.legend, textStyle: {...option.legend.textStyle, fontSize: 11}, itemGap: 10};
  }
  if (compact) {
    option.legend = {...option.legend, bottom: undefined, top: 0, left: 0};
    option.grid = {...option.grid, left: 48, right: option.yAxis.length > 1 ? 48 : 12, top: showLegend ? 46 : 28, bottom: 28};
  }
  return option;
}

function areaOption(chart, context) {
  const option = standardOption({...chart, series: chart.series.map(series => ({...series, type: 'line'}))}, {...context, showLegend: false, endLabels: false});
  const share = chart.view === 'area-share';
  option.series = option.series.map((series, index) => ({...series, stack: 'area', areaStyle: {color: context.colors[index % context.colors.length], opacity: .92}, lineStyle: {width: .6, color: '#fff'}, symbol: 'none', showSymbol: false, emphasis: {focus: 'series'}, endLabel: undefined}));
  option.yAxis = option.yAxis.map(axis => ({...axis, scale: false, ...(share ? {max: 100, min: 0} : {})}));
  option.tooltip = {...option.tooltip, order: 'seriesDesc'};
  option.legend = {...option.legend, show: true};
  option.grid = {...option.grid, right: 20};
  wrappedLegend(option, chart.series.map(series => series.name), context.width);
  return option;
}

function splitOption(chart, {colors, width = 600}) {
  const dates = dateCategories(chart), bars = chart.series.filter(series => seriesAxis(chart, series) === 0), lines = chart.series.filter(series => seriesAxis(chart, series) === 1);
  const units = axisUnits(chart), at = series => dates.map(date => series.data.find(point => point[0] === date)?.[1] ?? null);
  const label = {color: MUTED, fontSize: 11, fontFamily: FONT};
  return {animation: false, textStyle: {fontFamily: FONT, color: INK, fontSize: 11}, color: colors,
    tooltip: {trigger: 'axis', confine: true, backgroundColor: '#fff', borderColor: '#bdced3', textStyle: {color: INK, fontFamily: FONT, fontSize: 12}, formatter: axisTooltip(item => units[item.seriesIndex < bars.length ? 0 : 1])},
    axisPointer: {link: [{xAxisIndex: 'all'}]},
    grid: [{left: width < 520 ? 44 : 62, right: 14, top: 26, height: '48%'}, {left: width < 520 ? 44 : 62, right: 14, top: '68%', bottom: 30}],
    xAxis: [0, 1].map(gridIndex => ({type: 'category', gridIndex, data: dates, axisTick: {show: false}, axisLine: {lineStyle: {color: '#ccdadd'}}, axisLabel: {...label, show: gridIndex === 1, formatter: dateLabel, hideOverlap: true, showMinLabel: true, showMaxLabel: true}})),
    yAxis: [0, 1].map(gridIndex => ({type: 'value', gridIndex, name: units[gridIndex], nameTextStyle: {color: MUTED, fontSize: 10, align: 'left'}, scale: gridIndex === 1, splitNumber: gridIndex ? 2 : 4, axisLabel: {...label, formatter: value => chartTick(value)}, splitLine: {lineStyle: {color: RULE}}})),
    series: [...bars.map((series, index) => ({name: series.name, type: 'bar', xAxisIndex: 0, yAxisIndex: 0, data: at(series), barMaxWidth: 18, itemStyle: {color: colors[index]}, tooltip: {valueFormatter: value => quantity(value, units[0])}})),
      ...lines.map(series => ({name: series.name, type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: at(series), showSymbol: false, lineStyle: {width: 2.2, color: INK}, itemStyle: {color: INK}, tooltip: {valueFormatter: value => quantity(value, units[1])}}))]};
}

function dumbbellOption(chart, {colors}) {
  const {rows, label, earlierLabel} = dumbbellRows(chart), unit = axisUnits(chart)[0], ordered = rows.slice().reverse();
  const accent = '#B4553A';
  return {animation: false, textStyle: {fontFamily: FONT, color: INK, fontSize: 11},
    tooltip: {trigger: 'axis', axisPointer: {type: 'shadow'}, confine: true, backgroundColor: '#fff', borderColor: '#bdced3', textStyle: {color: INK, fontFamily: FONT, fontSize: 12}, formatter: axisTooltip(() => unit)},
    legend: {bottom: 0, data: [label, earlierLabel], textStyle: {color: MUTED, fontSize: 11, fontFamily: FONT}, itemWidth: 10, itemHeight: 10},
    grid: {left: 8, right: 54, top: 8, bottom: 36, containLabel: true},
    xAxis: {type: 'value', scale: true, axisLabel: {color: MUTED, fontSize: 11, formatter: value => chartTick(value) + (/%/.test(unit) ? '%' : '')}, splitLine: {lineStyle: {color: RULE}}},
    yAxis: {type: 'category', data: ordered.map(row => row.name), axisTick: {show: false}, axisLine: {show: false}, axisLabel: {color: INK, fontSize: 11, width: 150, overflow: 'truncate'}},
    series: [
      {type: 'custom', silent: true, tooltip: {show: false}, renderItem: (params, api) => {
        const index = api.value(0), a = api.coord([api.value(1), index]), b = api.coord([api.value(2), index]);
        return {type: 'line', shape: {x1: a[0], y1: a[1], x2: b[0], y2: b[1]}, style: {stroke: '#b8c4c6', lineWidth: 2}};
      }, encode: {x: [1, 2], y: 0}, data: ordered.map((row, index) => [index, row.before ?? row.now, row.now]), z: 1},
      {name: earlierLabel, type: 'scatter', symbolSize: 9, itemStyle: {color: '#fff', borderColor: '#8a9aa2', borderWidth: 1.5}, data: ordered.map(row => row.before), tooltip: {valueFormatter: value => quantity(value, unit)}, z: 2},
      // O rótulo fica do lado oposto ao ponto de 12 meses antes, fora da linha.
      {name: label, type: 'scatter', symbolSize: 10, itemStyle: {color: accent}, z: 3, tooltip: {valueFormatter: value => quantity(value, unit)},
        data: ordered.map(row => ({value: row.now, label: {position: row.before != null && row.before > row.now ? 'left' : 'right'}})),
        label: {show: true, color: INK, fontSize: 11, fontFamily: FONT, distance: 7, formatter: params => readable(params.value) + (/%/.test(unit) ? '%' : '')}},
    ]};
}

function StandardChart({chart, height = 280, colors, compact = false, showLegend = true, valueLabels}) {
  const node = useRef(null);
  const palette = colors || chart.colors || seriesColors(chart, 'web');
  useEffect(() => {
    if (!node.current) return;
    const host = node.current, instance = echarts.init(host, null, {renderer: 'svg'});
    const labelSettings = valueLabels === undefined ? chart.valueLabels : valueLabels;
    function build() {
      const context = {colors: palette, compact, showLegend, width: host.clientWidth};
      if (!compact && chart.view === 'split') return splitOption(chart, context);
      if (!compact && chart.view === 'dumbbell') return dumbbellOption(chart, context);
      if (!compact && (chart.view === 'area-share' || chart.view === 'area-stack')) return areaOption(chart, context);
      const option = standardOption(chart, context);
      if (labelSettings) {
        const totals = new Map(chart.totalData || []), lastBar = option.series.findLastIndex(series => series.type === 'bar');
        option.series = option.series.map((series, index) => {
          if (series.type !== 'bar') return series;
          const total = labelSettings.total && index === lastBar, inner = labelSettings.innerSeries === index;
          if (!total && !inner) return series;
          return {...series, labelLayout: {hideOverlap: true}, label: {show: true, position: total ? 'top' : 'inside', color: total ? INK : '#fff', fontSize: 11, fontFamily: FONT, ...(total ? {} : {backgroundColor: palette[index % palette.length], padding: [1, 2], align: 'center'}), formatter: params => {
            if (!total) {
              const plotWidth = Math.max(0, host.clientWidth - Number(option.grid.left || 0) - Number(option.grid.right || 0));
              if (!showInnerLabel(params.dataIndex, option.xAxis.data.length, plotWidth)) return '';
            }
            return chartLabel(total ? totals.get(params.name ?? option.xAxis.data[params.dataIndex]) : params.value);
          }}};
        });
      }
      return option;
    }
    instance.setOption(build());
    let lastWidth = host.clientWidth;
    const resize = new ResizeObserver(() => {
      const width = host.clientWidth;
      if (width !== lastWidth) instance.setOption(build(), true);
      instance.resize();
      lastWidth = width;
    });
    resize.observe(host);
    return () => {resize.disconnect(); instance.dispose();};
  }, [chart, palette.join(), compact, showLegend, valueLabels]);
  return <div className="tc-chart" style={{height}} ref={node} role="img" aria-label={`${plainText(chart.title)}. ${shownUnits(chart).join(' / ')}. ${periodOf(chart)}.`}/>;
}

/* ---------- Grade de UFs ---------- */

function UfTiles({chart}) {
  const {tiles, min, max, ramp, cols, rows} = ufTiles(chart, 'web'), unit = chart.unit || '';
  const size = 44, gap = 4, width = cols * (size + gap), height = rows * (size + gap);
  return <figure className="tc-tiles">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${plainText(chart.title)} por UF. ${tiles.filter(tile => tile.value != null).map(tile => `${tile.uf} ${readable(tile.value)}`).join(', ')}.`}>
      {tiles.map(tile => <g key={tile.uf} transform={`translate(${tile.col * (size + gap)} ${tile.row * (size + gap)})`}>
        <rect width={size} height={size} rx="2" fill={tile.color}><title>{`${tile.uf}: ${tile.value == null ? 'N/D' : quantity(tile.value, unit)}`}</title></rect>
        <text x="5" y="15" className="tc-tile-uf" fill={tile.dark ? '#fff' : INK}>{tile.uf}</text>
        <text x={size - 5} y={size - 7} textAnchor="end" className="tc-tile-value" fill={tile.dark ? '#fff' : INK}>{tile.value == null ? 'N/D' : readable(tile.value)}</text>
      </g>)}
    </svg>
    <figcaption><span>{quantity(min, unit)}</span><span className="tc-tile-ramp" aria-hidden="true">{ramp.map(color => <i key={color} style={{background: color}}/>)}</span><span>{quantity(max, unit)}</span></figcaption>
  </figure>;
}

/* ---------- Matriz produto × canal ---------- */

function ChannelMatrix({chart}) {
  const {matrix} = chart, rate = matrix.kind === 'rate';
  const values = matrix.rows.flatMap(row => matrix.columns.map(column => row.values[column])).filter(finite);
  const low = Math.min(...values), high = Math.max(...values);
  const level = value => rate ? (value - low) / (high - low || 1) : value / 100;
  const shade = value => value == null ? 'transparent' : `rgba(44,101,127,${Math.min(1, .06 + level(value) * .94).toFixed(3)})`;
  const text = value => value == null ? 'N/D' : rate ? readable(value) + '%' : value < .5 && value > 0 ? '<1%' : `${Math.round(value)}%`;
  return <div className="tc-matrix-scroll"><table className="tc-matrix">
    <thead><tr><th scope="col">{matrix.head}</th>{matrix.columns.map(column => <th scope="col" key={column}>{matrix.short[column] || column}</th>)}{matrix.totalLabel && <th scope="col">{matrix.totalLabel}</th>}</tr></thead>
    <tbody>{matrix.rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th>{matrix.columns.map(column => {
      const value = row.values[column];
      return <td key={column} style={{background: shade(value), color: value != null && level(value) >= .55 ? '#fff' : INK}}>{text(value)}</td>;
    })}{matrix.totalLabel && <td className="tc-matrix-total">{quantity(row.total, matrix.unit)}</td>}</tr>)}</tbody>
  </table>{matrix.columnNote && <p className="tc-matrix-note">Colunas: {matrix.columnNote}.</p>}</div>;
}

/* ---------- Versões para celular ---------- */

function DumbbellList({chart}) {
  const {rows, label, earlierLabel} = dumbbellRows(chart), unit = axisUnits(chart)[0], pct = /%/.test(unit);
  const values = rows.flatMap(row => [row.now, row.before]).filter(finite);
  const low = Math.min(0, ...values), high = Math.max(0, ...values), at = value => ((value - low) / (high - low || 1)) * 100;
  const text = value => readable(value) + (pct ? '%' : '');
  return <div className="tc-dumbbell-list">
    <p className="tc-dumbbell-legend"><span className="is-now"/>{label}<span className="is-before"/>{earlierLabel}</p>
    <ol>{rows.map(row => <li key={row.name}>
      <div className="tc-dumbbell-head"><span>{row.name}</span><strong>{text(row.now)}</strong></div>
      <div className="tc-dumbbell-track" role="img" aria-label={`${row.name}: ${text(row.now)} em ${label}${row.before != null ? `, ${text(row.before)} em ${earlierLabel}` : ''}.`}>
        {low < 0 && high > 0 && <i className="tc-dumbbell-zero" style={{left: `${at(0)}%`}}/>}
        {row.before != null && <i className="tc-dumbbell-span" style={{left: `${Math.min(at(row.before), at(row.now))}%`, width: `${Math.abs(at(row.now) - at(row.before))}%`}}/>}
        {row.before != null && <i className="tc-dumbbell-dot is-before" style={{left: `${at(row.before)}%`}}/>}
        <i className="tc-dumbbell-dot is-now" style={{left: `${at(row.now)}%`}}/>
      </div>
    </li>)}</ol>
  </div>;
}

const SHARE_INK = ['#B4553A', '#2C657F', '#6BA5BD', '#7C3522', '#16323F', '#E3A48C', '#9AC4D4'];
function ShareList({chart}) {
  const {matrix} = chart, columns = matrix.columns || matrix.channels;
  return <div className="tc-share-list">
    <p className="tc-share-legend">{columns.map((column, index) => <span key={column}><i style={{background: SHARE_INK[index % SHARE_INK.length]}}/>{matrix.short[column] || column}</span>)}</p>
    <ol>{matrix.rows.map(row => <li key={row.id}>
      <div className="tc-dumbbell-head"><span>{row.label}</span><small>{quantity(row.total, matrix.unit)}</small></div>
      <div className="tc-share-bar" role="img" aria-label={`${row.label}: ${columns.filter(column => row.values[column] != null).map(column => `${matrix.short[column] || column} ${Math.round(row.values[column])}%`).join(', ')}.`}>
        {columns.map((column, index) => row.values[column] > 0 ? <i key={column} style={{width: `${row.values[column]}%`, background: SHARE_INK[index % SHARE_INK.length]}}>{row.values[column] >= 14 ? `${Math.round(row.values[column])}%` : ''}</i> : null)}
      </div>
    </li>)}</ol>
  </div>;
}

function RateList({chart}) {
  const {matrix} = chart, columns = matrix.columns;
  const values = matrix.rows.flatMap(row => columns.map(column => row.values[column])).filter(finite), low = Math.min(...values), high = Math.max(...values);
  const level = value => (value - low) / (high - low || 1);
  return <div className="tc-rate-list" style={{'--columns': columns.length}}>
    <div className="tc-rate-cells tc-rate-head">{columns.map(column => <span key={column}>{matrix.short[column] || column}</span>)}</div>
    <ol>{matrix.rows.map(row => <li key={row.id}>
      <span className="tc-rate-label">{row.label}</span>
      <div className="tc-rate-cells">{columns.map(column => {const value = row.values[column]; return <span key={column} style={{background: value == null ? 'transparent' : `rgba(44,101,127,${(.08 + level(value) * .92).toFixed(3)})`, color: value != null && level(value) >= .55 ? '#fff' : INK}}>{value == null ? 'N/D' : readable(value)}</span>;})}</div>
    </li>)}</ol>
    {matrix.columnNote && <p className="tc-matrix-note">Colunas: {matrix.columnNote}. Valores em %.</p>}
  </div>;
}

/* ---------- Painel ---------- */

export function ChartPanel({chart: group, showNotes = true, lead = false, stretch = false, quiet = false}) {
  const [choice, setChoice] = useState(0);
  const [mode, setMode] = useState('chart');
  const [sideIndex, setSideIndex] = useState(0);
  const narrow = useNarrow();
  useEffect(() => {setMode('chart'); setChoice(0); setSideIndex(0);}, [group.id]);
  const options = group.alternatives || null, picked = options ? options[Math.min(choice, options.length - 1)].chart : group;
  const sides = narrow ? narrowSides(picked) : null, chart = sides ? {...sides[sideIndex].chart, reading: picked.reading} : picked;
  const hasValues = chart.series.some(series => series.data.some(point => point[1] != null && Number.isFinite(Number(point[1]))));
  // `quiet`: os números-chave já citam este gráfico; o título descreve e a leitura não se repete.
  const title = plainText(group.alternatives ? group.title : chart.title), reading = quiet ? null : chart.reading?.text;
  const original = chart.view === 'dumbbell' ? {...chart, view: undefined, smallMultiples: false} : null;
  const period = chart.view === 'matrix' ? chart.matrix.label : periodOf(chart);
  const wide = lead || stretch || panelWide(group), rows = chart.view === 'dumbbell' && mode !== 'series' ? dumbbellRows(chart).rows.length : 0;
  const height = lead ? 340 : wide && rows ? Math.max(300, 50 + rows * 28) : 300;
  return <article className={'tc-chart-panel' + (wide ? ' is-wide' : '') + (lead ? ' is-lead' : '')}>
    <header className="tc-chart-panel-heading">
      <div>{reading ? <><p className="tc-chart-kicker">{title}</p><h2>{reading}</h2></> : <h2>{title}</h2>}<p>{unitCaption(chart)}{chart.smallMultiples ? ' · escala própria por série' : ''}{chart.view === 'matrix' ? '' : ` · ${period}`}{chart.historical ? ' · série encerrada' : ''}</p></div>
      {(options || original) && <div className="tc-chart-modes">
        {options && <div className="tc-chart-choice" role="group" aria-label={`Ver ${title} por`}>{options.map((option, index) => <button type="button" key={option.label} aria-pressed={index === choice} onClick={() => {setChoice(index); setMode('chart');}}>{option.label}</button>)}</div>}
        {original && <button type="button" className="tc-text-action" aria-pressed={mode === 'series'} onClick={() => setMode(mode === 'series' ? 'chart' : 'series')}>{mode === 'series' ? 'Comparação' : 'Série'}</button>}
      </div>}
    </header>
    {sides && <div className="tc-chart-choice tc-chart-sides" role="group" aria-label="Grupo de séries">{sides.map((side, index) => <button type="button" key={side.label} aria-pressed={index === sideIndex} onClick={() => setSideIndex(index)}>{side.label}</button>)}</div>}
    {hasValues ? <Chart chart={mode === 'series' && original ? original : chart} height={height} fixed={!wide}/> : <p className="tc-empty">Sem observações neste intervalo. Escolha outro período para consultar a série.</p>}
    {showNotes && chart.note && <details className="tc-chart-note"><summary>Notas</summary><p>{plainText(chart.note)}</p></details>}
  </article>;
}

/* ---------- Números-chave ---------- */

function Spark({points}) {
  const values = points.map(point => point[1]).filter(finite);
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), width = 120, height = 30;
  const path = points.map((point, index) => finite(point[1]) ? `${index ? 'L' : 'M'}${(index / (points.length - 1) * width).toFixed(1)},${(height - 2 - (point[1] - min) / (max - min || 1) * (height - 4)).toFixed(1)}` : '').join('');
  return <svg className="tc-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><path d={path}/></svg>;
}

export function KeyFigures({figures}) {
  if (!figures?.length) return null;
  return <dl className="tc-key-figures">{figures.map(figure => <div key={figure.label + figure.chart}>
    <dt>{figure.label}</dt>
    <dd className="tc-key-value">{figure.text}</dd>
    <dd className="tc-key-context">{figure.when || 'N/D'}{figure.deltaText ? ` · ${figure.deltaText} em 12 meses` : ''}</dd>
    <dd><Spark points={figure.spark}/></dd>
  </div>)}</dl>;
}

/* ---------- Exportação ---------- */

export function ExportMenu({charts = [], title, allCharts, collection, collectionTitle = 'Todos os gráficos', deck = {}, onError, disabled = false}) {
  const node = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    function outside(event) {if (node.current?.open && !node.current.contains(event.target)) node.current.open = false;}
    function escape(event) {if (event.key === 'Escape' && node.current?.open) {node.current.open = false; node.current.querySelector('summary')?.focus();}}
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);};
  }, []);
  async function pptx(items, name) {
    if (busy || disabled) return;
    setBusy(true);
    setStatus('Preparando PPTX…');
    try {
      const result = await exportPptx(items, name, deck);
      setStatus(result.complete ? 'PPTX preparado.' : `PPTX parcial: ${result.exported} de ${result.total} gráficos com observações. As ausências constam do arquivo.`);
    } catch (error) {
      setStatus(error.message);
      onError?.(error.message);
    } finally {setBusy(false);}
  }
  function csv() {
    try {csvDownload(charts.flatMap(chart => chart.csvSources || [chart]), title); setStatus('CSV preparado.');} catch (error) {setStatus(error.message); onError?.(error.message);}
  }
  return <details ref={node} className="tc-export-menu">
    <summary>Exportar</summary>
    <div className="tc-export-options">
      <strong>{title}</strong>
      <button type="button" disabled={busy || disabled || !charts.length} onClick={csv}>Seleção · CSV</button>
      <button type="button" disabled={busy || disabled || !charts.length} onClick={() => pptx(charts, title)}>Seleção · PowerPoint</button>
      {collection && <button type="button" disabled={busy || disabled || !collection.length} onClick={() => pptx(collection, collectionTitle)}>{collectionTitle} · {collection.length} gráficos</button>}
      {allCharts && <button type="button" disabled={busy || disabled || !allCharts.length} onClick={() => pptx(allCharts, 'Crédito e mercado imobiliário')}>Crédito e imobiliário · {allCharts.length} gráficos</button>}
      {status && <p role="status" aria-live="polite">{status}</p>}
    </div>
  </details>;
}
