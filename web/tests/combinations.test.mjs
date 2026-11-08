import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import {combineCharts, splitAxes} from '../src/chart-combinations.js';
import {orderTopic, presentSeriesChart, seriesTopics, topicExtras} from '../src/series-presentation.js';
import {seriesCollections} from '../src/series-data.js';
import {institutionDeckCharts} from '../src/institution-export-data.js';
import {buildPptx, repairPptxPackage} from '../src/export.js';

const read=async name=>JSON.parse(await readFile(new URL('../public/data/'+name+'.json',import.meta.url),'utf8'));
const [sfn,extra,imob,catalog]=await Promise.all(['sfn','extra','imob-br','institutions'].map(read));
const all=seriesCollections({sfn,extra,imob,window:'all'});

function page(name,charts){
  const presented=[...topicExtras(name,charts),...charts.map(chart=>presentSeriesChart(chart,name))];
  return seriesTopics(name,presented).flatMap(topic=>combineCharts(name,orderTopic(topic.id,presented.filter(chart=>chart.topic===topic.id))));
}
const flat=charts=>charts.flatMap(chart=>chart.alternatives?chart.alternatives.map(option=>option.chart):[chart]);
const strip=name=>name.replace(/ \(dir\.\)$/,'');

test('each page shows far fewer panels than published charts',()=>{
  assert.equal(page('sfn',all.sfn).length,33);
  assert.equal(page('payments',all.payments).length,13);
  assert.equal(page('imob',all.imob).length,12);
});

test('combined charts carry published points unchanged, and every source chart reaches the CSV',()=>{
  for(const [name,charts] of [['sfn',all.sfn],['payments',all.payments],['imob',all.imob]]){
    const combined=page(name,charts),sources=new Map(charts.map(chart=>[chart.id,chart]));
    const csv=new Set(combined.flatMap(chart=>(chart.csvSources||[chart]).map(source=>source.id)));
    for(const id of sources.keys())assert.ok(csv.has(id),`${name}: ${id} still reaches the CSV`);
    for(const chart of flat(combined).filter(chart=>chart.combined)){
      for(const series of chart.series){
        if(chart.id==='pay-canais-total'||/_pj_total$/.test(series.name)||series.name==='PJ, soma das modalidades (dir.)')continue;
        const origin=(chart.csvSources||[]).flatMap(source=>source.series).find(entry=>JSON.stringify(entry.data)===JSON.stringify(series.data));
        assert.ok(origin,`${chart.id} · ${series.name} reuses a published series`);
      }
    }
  }
});

test('the axis rule keeps each side within a sixfold range and states what it leaves out',()=>{
  const consolidated=page('payments',all.payments).find(chart=>chart.id==='spb-consolidado-quantidade');
  const left=consolidated.series.filter(series=>!series.axis).map(series=>series.name),right=consolidated.series.filter(series=>series.axis===1).map(series=>strip(series.name));
  assert.deepEqual(left,['Cartões','Cobranças','Pix']);
  assert.deepEqual(right,['Saques','Transferências Interbancárias','Transferências Intrabancárias']);
  assert.match(consolidated.note,/Fora do desenho.*Cheque/);
  const series=[3000,900,600,40,9,0.1].map((value,index)=>({name:'s'+index,data:[['2026-01-01',value]]}));
  const split=splitAxes(series);
  assert.deepEqual([split.left,split.right,split.out].map(list=>list.map(entry=>entry.name)),[['s0','s1','s2'],['s3','s4'],['s5']]);
  const terms=page('sfn',all.sfn).find(chart=>chart.id==='cred-concessoes-prazo');
  assert.deepEqual(terms.series.filter(series=>series.axis===1).map(series=>series.name),['Crédito imobiliário (dir.)']);
});

test('toggles keep both views and the PPTX gives each its own page',async()=>{
  const monthly=page('payments',all.payments).find(chart=>chart.id==='pay-mensal');
  assert.deepEqual(monthly.alternatives.map(option=>option.label),['Quantidade','Valor']);
  const {presentation,plan}=buildPptx([{...monthly,topic:'t',topicLabel:'Transações'}],'Pagamentos',PptxGenJS);
  assert.equal(plan.pages.filter(page=>page.type==='chart').length,2);
  const zip=await JSZip.loadAsync(await repairPptxPackage(await presentation.write({outputType:'arraybuffer'})));
  const xml=(await Promise.all(zip.file(/^ppt\/slides\/slide\d+\.xml$/).map(entry=>entry.async('string')))).join('');
  assert.match(xml,/Quantidade/);assert.match(xml,/Valor/);
});

test('the institution deck has eight charts and the CSV keeps every indicator',async()=>{
  const bank=catalog.institutions.find(entry=>entry.id==='5f6d3c0745685d8f');
  const payload=await read(bank.historyPath.replace(/^data\//,'').replace(/\.json$/,''));
  const charts=institutionDeckCharts({bank,payload,metrics:catalog.metrics,period:'2026-Q2',window:'12'});
  assert.equal(charts.length,8);
  assert.deepEqual([...new Set(charts.map(chart=>chart.topicLabel))],['Balanço','Resultado','Carteira','Capital']);
  const csv=new Set(charts.flatMap(chart=>chart.csvSources.map(source=>source.id)));
  for(const key of Object.keys(catalog.metrics))assert.ok(csv.has('institution-'+key),key);
  const volumes=charts[0];
  assert.equal(volumes.series.find(series=>series.axis===1)?.name,'Patrimônio líquido (dir.)');
  const losses=charts.find(chart=>chart.title==='Estágios e perda esperada');
  assert.ok(losses.series.find(series=>/Perda esperada/.test(series.name)).data.some(([,value])=>value<0),'expected loss keeps its sign');
});
