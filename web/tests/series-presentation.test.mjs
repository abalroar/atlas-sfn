import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {seriesCollections} from '../src/series-data.js';
import {seriesTopics,topicForChart,presentSeriesChart,chartNotes} from '../src/series-presentation.js';
import {institutionSnapshotCharts,rankingExportCharts} from '../src/institution-export-data.js';
import {csvRows} from '../src/data.js';

const read=async name=>JSON.parse(await readFile(new URL('../public/data/'+name+'.json',import.meta.url),'utf8'));
const [sfn,extra,imob,catalog]=await Promise.all(['sfn','extra','imob-br','institutions'].map(read));

test('concise topics keep all 104 charts, original series, units, periods and ordering inside each topic',()=>{
  const original=JSON.stringify({sfn,extra,imob});
  const collections=seriesCollections({sfn,extra,imob,window:'all'});
  for(const [page,count] of [['sfn',51],['imob',24],['payments',29]]){
    const raw=collections[page],presented=raw.map(chart=>presentSeriesChart(chart,page));
    const topics=seriesTopics(page,presented),seen=topics.flatMap(topic=>presented.filter(chart=>topicForChart(page,chart)===topic.id));
    assert.equal(seen.length,count);
    assert.equal(new Set(seen.map(chart=>chart.id)).size,count);
    assert.deepEqual(seen.map(chart=>chart.id).sort(),raw.map(chart=>chart.id).sort());
    for(const [index,chart] of presented.entries()){
      assert.equal(chart.series,raw[index].series);
      for(const key of ['id','section','unit','percent','stacked','axes','source','historical','latestPeriod'])assert.deepEqual(chart[key],raw[index][key]);
    }
    for(const topic of topics)assert.deepEqual(seen.filter(chart=>topicForChart(page,chart)===topic.id).map(chart=>chart.id),raw.filter(chart=>topicForChart(page,chart)===topic.id).map(chart=>chart.id));
  }
  assert.equal(JSON.stringify({sfn,extra,imob}),original);
  assert.deepEqual(seriesTopics('sfn',collections.sfn).map(topic=>topic.label),['Panorama','Concessões','Carteiras','Inadimplência','Juros e spread']);
  const future={id:'future',section:'Nova publicação',series:[]};
  assert.ok(seriesTopics('sfn',[...collections.sfn,future]).some(topic=>topic.id===topicForChart('sfn',future)),'an unrecognized future section remains reachable');
});

test('housing identifies PF/PJ, retains historical risk warnings and groups repeated payment definitions without losing them',()=>{
  const presented=imob.map(chart=>presentSeriesChart(chart,'imob'));
  assert.match(presented.find(chart=>chart.id==='contratacao_valor_pf').title,/PF$/);
  assert.match(presented.find(chart=>chart.id==='contratacao_valor_pj').title,/PJ$/);
  assert.ok(presented.filter(chart=>chart.historical).every(chart=>chart.note.includes('dezembro/2024')&&chart.note.includes('4.966')));
  const payments=extra.filter(chart=>chart.id.startsWith('spb')).map(chart=>presentSeriesChart(chart,'payments'));
  assert.ok(payments.find(chart=>chart.id==='spb-trimestral-quantidade').smallMultiples);
  assert.ok(!payments.find(chart=>chart.id==='spb-participacao-quantidade').smallMultiples);
  assert.ok(!payments.find(chart=>chart.id==='spb-cartoes-qtd_cartoes_ativos').smallMultiples);
  const notes=chartNotes(payments);
  assert.equal(notes.flatMap(note=>note.charts).length,payments.length);
  assert.ok(notes.length<payments.length);
  assert.ok(notes.some(note=>/denominador/.test(note.text)));
  assert.ok(notes.some(note=>/pessoas únicas/.test(note.text)));
});

test('Dados export matches the selected raw snapshot and keeps missing, signs and the other analysis scales intact',async()=>{
  const bank=catalog.institutions.find(entry=>entry.id==='5f6d3c0745685d8f');
  const payload=await read(bank.historyPath.replace(/^data\//,'').replace(/\.json$/,''));
  const period='2026-Q2',row=payload.history.find(entry=>entry.period===period);
  const charts=institutionSnapshotCharts({bank,payload,metrics:catalog.metrics,period});
  assert.equal(charts.length,23);
  for(const [key,metric] of Object.entries(catalog.metrics)){
    const chart=charts.find(chart=>chart.id==='institution-'+key);
    assert.equal(chart.unit,metric.unit);
    assert.deepEqual(chart.series[0].data,[[row.date,row.values[key]??null]]);
  }
  assert.equal(charts.find(chart=>chart.id==='institution-assets').series[0].data[0][1],2846417632562.91);
  assert.equal(charts.find(chart=>chart.id==='institution-expectedLoss').series[0].data[0][1],-53697595590.89);
  assert.throws(()=>institutionSnapshotCharts({bank,payload:{...payload,perimeter:'Individual'},metrics:catalog.metrics,period}),/perímetro/);
});

test('ranking CSV is sorted like the observed perimeter, preserves official values and gives zero and missing an explicit state',()=>{
  const charts=rankingExportCharts(catalog,'Prudencial','roe');
  const eligible=catalog.institutions.filter(bank=>bank.perimeter==='Prudencial'&&bank.latestPeriod===catalog.latestPeriod&&typeof bank.latest.roe==='number'&&Number.isFinite(bank.latest.roe));
  assert.equal(charts.length,eligible.length);
  assert.ok(charts.every((chart,index)=>chart.rank===index+1&&(index===0||charts[index-1].series[0].data[0][1]>=chart.series[0].data[0][1])));
  for(const chart of charts)assert.equal(chart.series[0].data[0][1],catalog.institutions.find(bank=>bank.id===chart.id).latest.roe);
  const rows=csvRows([{id:'observation',title:'Valores',unit:'R$',source:'BCB',note:'Critério',series:[{name:'Saldo',data:[['2026-01',0],['2026-02',null],['2026-03',-4]]}]}]);
  const state=rows[0].indexOf('Estado');
  assert.deepEqual(rows.slice(1).map(row=>[row[3],row[state]]),[[0,'Observado'],[null,'N/D'],[-4,'Observado']]);
  assert.equal(rows[0][6],'Seção');assert.equal(rows[0][7],'Critério');
});
