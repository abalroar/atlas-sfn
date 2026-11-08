import React, {useEffect, useRef} from 'react';
import * as echarts from 'echarts';
import {chartCategories, dateLabel} from './data.js';
import {chartTick} from './chart-format.js';
import {displayScale, quantity, retiredSeries, seriesColors} from './editorial.js';

export default function SmallMultiples({chart: source}) {
  const node = useRef(null);
  // Séries encerradas (zero nos últimos registros) ficam na tabela; os painéis mostram as ativas.
  const colors = seriesColors(source, 'web'), chart = {...source, series: source.series.filter(series => !retiredSeries(series))};
  const palette = source.series.map((series, index) => [series.name, colors[index]]), colorOf = name => new Map(palette).get(name);
  const rows = Math.ceil(chart.series.length / 2), height = rows * 138;
  useEffect(() => {
    const host = node.current;
    if (!host) return;
    const instance = echarts.init(host, null, {renderer: 'svg'});
    function draw() {
      const width = host.clientWidth, gap = 24, cell = (width - gap) / 2;
      const dates = chartCategories(chart);
      const grids = [], xAxis = [], yAxis = [], series = [], graphic = [];
      chart.series.forEach((item, index) => {
        const x = (index % 2) * (cell + gap), y = Math.floor(index / 2) * 138;
        const observed = item.data.some(([,value]) => value != null && Number.isFinite(value));
        const scale = displayScale(chart.unit, item.data.map(point => point[1]));
        graphic.push({type: 'text', left: x, top: y + 2, style: {text: `${item.name} · ${scale.unit}`, fill: '#213e50', font: "500 11px 'Hanken Grotesk Variable', sans-serif", width: cell, overflow: 'truncate'}});
        if (!observed) graphic.push({type: 'text', left: x + cell / 2 - 10, top: y + 54, style: {text: 'N/D', fill: '#506a76', font: '12px sans-serif'}});
        grids.push({left: x + 42, top: y + 26, width: Math.max(20, cell - 48), height: 78});
        xAxis.push({type: 'category', gridIndex: index, data: dates, axisTick: {show: false}, axisLine: {lineStyle: {color: '#cfd8d6'}}, axisLabel: {fontSize: 9, color: '#506a76', formatter: (value, at) => at === 0 || at === dates.length - 1 ? dateLabel(value) : '', hideOverlap: true, showMinLabel: true, showMaxLabel: true}});
        yAxis.push({type: 'value', gridIndex: index, splitNumber: 2, axisLabel: {fontSize: 9, color: '#506a76', formatter: value => chartTick(value / scale.factor)}, splitLine: {lineStyle: {color: '#e0e6e3'}}});
        const values = new Map(item.data);
        series.push({name: item.name, type: 'line', xAxisIndex: index, yAxisIndex: index, data: dates.map(date => values.get(date) ?? null), showSymbol: dates.length <= 4, symbolSize: 3, connectNulls: false, lineStyle: {width: 2}, itemStyle: {color: colorOf(item.name)}});
      });
      instance.setOption({animation: false, textStyle: {fontFamily: 'Hanken Grotesk Variable, Hanken Grotesk, Arial, sans-serif'}, grid: grids, xAxis, yAxis, series, graphic, tooltip: {trigger: 'axis', confine: true, valueFormatter: value => quantity(value, chart.unit)}}, true);
      instance.resize();
    }
    draw();
    const resize = new ResizeObserver(draw); resize.observe(host);
    return () => {resize.disconnect(); instance.dispose();};
  }, [source]);
  return <div className="tc-chart tc-small-multiples" ref={node} style={{height}} role="img" aria-label={`${chart.title}. ${chart.unit}. ${chart.series.length} séries com escalas próprias.`}/>;
}
