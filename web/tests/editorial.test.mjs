import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import {chartReading, displayScale, keyFigures, quantity, retiredSeries, seriesColors, changeText} from '../src/editorial.js';
import {channelMatrix, channelMatrixChart, dumbbellRows, ufTiles, UF_TILES, bandCategories} from '../src/chart-views.js';
import {presentSeriesChart, topicExtras, orderTopic, chartView} from '../src/series-presentation.js';
import {buildPptx, repairPptxPackage, deckPlan} from '../src/export.js';
import {positionRulers, rulerScale} from '../src/institution-profile.js';
import {filterChart} from '../src/data.js';

const read=async name=>JSON.parse(await readFile(new URL('../public/data/'+name+'.json',import.meta.url),'utf8'));
const [sfn,extra,catalog]=await Promise.all(['sfn','extra','institutions'].map(read));
const byId=id=>[...sfn,...extra].find(chart=>chart.id===id);

test('readings quote the published values and compare with the same month a year earlier',()=>{
  const stock=byId('credito_estoque-1'),date='2026-09-01',before='2025-09-01';
  const sum=day=>stock.series.reduce((total,series)=>total+series.data.find(point=>point[0]===day)[1],0);
  const reading=chartReading(stock);
  assert.equal(reading.date,date);
  assert.equal(reading.figures[0].value,sum(date));
  assert.ok(Math.abs(reading.figures[0].delta.value-(sum(date)/sum(before)-1)*100)<1e-9);
  assert.match(reading.text,/^R\$ 7\.444 bi em set\/2026, \+8,6% em 12 meses$/);
  // Growth series keep their sign and say "real" only when the unit says so.
  assert.match(chartReading(byId('credito_estoque-2')).text,/^Crédito ampliado: cresce 6,6% em termos reais em 12 meses até set\/2026$/);
  assert.match(chartReading(byId('credito_produto-3')).text,/maior queda: Financiamento à exportação \(−12,7%\)/);
  // Rates compare in percentage points.
  assert.match(chartReading(byId('taxas-5')).text,/% a\.a\. em set\/2026, \+3,7 p\.p\. em 12 meses$/);
  // Categorical UF chart names the extremes.
  assert.match(chartReading(byId('scr-7')).text,/^Maior em AL \(11,5%\), menor em SC \(7,29%\)$/);
  // A missing comparison point drops the comparison instead of inventing one.
  const short={id:'x',unit:'R$ bi',series:[{name:'A',type:'line',data:[['2026-08-01',10],['2026-09-01',12]]}]};
  assert.equal(chartReading(short).text,'R$ 12,0 bi em set/2026');
  assert.equal(changeText({value:0.001,unit:'p.p.'}),'estável');
});

test('display scales change labels only and keep the published unit in charts and workbooks',async()=>{
  const pix=byId('spb-mensal-quantidade');
  const scale=displayScale(pix.unit,pix.series.flatMap(series=>series.data.map(point=>point[1])));
  assert.deepEqual([scale.factor,scale.unit,scale.original,scale.excel],[1e6,'bi de transações','mil transações','#,##0.0,,']);
  assert.equal(quantity(7975215.71,'mil transações'),'7,98 bi de transações');
  assert.equal(quantity(341104.26,'mil transações'),'341 mi de transações');
  assert.equal(displayScale('R$ bi',[7444]).factor,1);
  const presented=presentSeriesChart(filterChart(pix,'12'),'payments',pix);
  const {presentation}=buildPptx([presented],'Pagamentos',PptxGenJS);
  const zip=await JSZip.loadAsync(await repairPptxPackage(await presentation.write({outputType:'arraybuffer'})));
  const chart=await zip.file('ppt/charts/chart1.xml').async('string');
  assert.match(chart,/formatCode="#,##0\.0,,"/);
  assert.match(chart,/<c:v>7975215\.71<\/c:v>/,'the native chart keeps the value in thousands of transactions');
  assert.match(chart,/<c:areaChart>/);
});

test('concept colors stay fixed across charts and never repeat inside one chart',()=>{
  const charts=[byId('credito_estoque-1'),byId('credito_tomador-0'),byId('concessoes-0')];
  for(const medium of ['web','pptx']){
    const colorOf=(chart,name)=>seriesColors(chart,medium)[chart.series.findIndex(series=>series.name===name)];
    for(const name of ['PF livre','PJ livre','PF direcionado','PJ direcionado'])assert.equal(new Set(charts.map(chart=>colorOf(chart,name))).size,1,name);
    for(const chart of [...sfn,...extra]){const colors=seriesColors(chart,medium);assert.equal(new Set(colors).size,Math.min(colors.length,new Set(colors).size));}
    const npl=byId('npl_pre_inad-0');assert.equal(new Set(seriesColors(npl,medium)).size,npl.series.length);
  }
});

test('retired instruments leave the panels with a dated note while table data keep every zero',()=>{
  const monthly=byId('spb-mensal-quantidade');
  assert.deepEqual(monthly.series.map(retiredSeries).filter(Boolean),[{name:'DOC',last:'2024-02-01'},{name:'TEC',last:'2024-02-01'}]);
  const presented=presentSeriesChart(monthly,'payments');
  assert.equal(presented.series,monthly.series,'the chart object still carries every series for table and CSV');
  assert.match(presented.note,/DOC e TEC registram zero depois de fev\/2024/);
  const share=dumbbellRows(byId('spb-participacao-quantidade'));
  assert.ok(!share.rows.some(row=>['DOC','TEC'].includes(row.name)));
  assert.deepEqual(share.left.sort(),['DOC','TEC']);
  assert.equal(share.rows[0].name,'Pix');
});

test('dumbbells, UF tiles and the channel matrix reorganize published values without changing them',()=>{
  const growth=byId('credito_produto-3'),rows=dumbbellRows(growth);
  assert.equal(rows.date,'2026-09-01');
  for(const row of rows.rows){
    const series=growth.series.find(entry=>entry.name===row.name);
    assert.equal(row.now,series.data.find(point=>point[0]==='2026-09-01')[1]);
    assert.equal(row.before,series.data.find(point=>point[0]==='2025-09-01')?.[1]??null);
  }
  assert.ok(rows.rows.every((row,index)=>!index||rows.rows[index-1].now>=row.now));
  const uf=byId('scr-7'),tiles=ufTiles(uf);
  assert.equal(tiles.tiles.length,27);assert.equal(Object.keys(UF_TILES).length,27);
  for(const tile of tiles.tiles)assert.equal(tile.value,uf.series[0].data.find(([key])=>key===tile.uf)?.[1]??null);
  const matrix=channelMatrix(extra);
  assert.equal(matrix.date,'2026-03-31');
  for(const row of matrix.rows){
    const total=Object.values(row.shares).filter(value=>value!=null).reduce((sum,value)=>sum+value,0);
    assert.ok(Math.abs(total-100)<1e-9,row.product);
    const source=extra.find(chart=>chart.id===row.id);
    const missing=source.series.filter(series=>series.data.find(point=>point[0]===matrix.date)?.[1]==null).map(series=>series.name);
    for(const channel of missing)assert.equal(row.shares[channel]??null,null,`${row.product} · ${channel} stays N/D`);
  }
  const chart=channelMatrixChart(extra);
  assert.equal(chart.view,'matrix');assert.match(chart.reading.text,/^O celular concentra \d+% das transações por canal em mar\/2026/);
  assert.equal(topicExtras('payments',extra)[0].id,'spb-canais-matriz');
  assert.deepEqual(bandCategories([{from:'2014-04-01',to:'2016-12-01'}],['2014-03-01','2014-04-01','2016-12-01','2017-01-01']).map(band=>[band.start,band.end]),[['2014-04-01','2016-12-01']]);
});

test('views follow the chart structure and leave housing as published',()=>{
  assert.equal(chartView(byId('credito_produto-0'),'sfn'),'area-share');
  assert.equal(chartView(byId('concessoes-1'),'sfn'),'split');
  assert.equal(chartView(byId('scr-7'),'sfn'),'tiles');
  assert.equal(chartView(byId('credito_produto-2'),'sfn'),'dumbbell');
  assert.equal(chartView(byId('spb-mensal-valor'),'payments'),'area-stack');
  assert.equal(chartView(byId('credito_estoque-1'),'sfn'),undefined);
  assert.equal(chartView({...byId('credito_produto-0')},'imob'),undefined);
  const topic=orderTopic('inadimplencia',sfn.concat(extra).filter(chart=>/^(npl|scr)/.test(chart.id)));
  assert.deepEqual(topic.slice(0,3).map(chart=>chart.id),['npl_pre_inad-0','scr-7','scr-8']);
});

test('the editorial deck has cover, contents with page numbers, dividers with key figures, footers and notes',async()=>{
  const charts=['credito_estoque-1','credito_estoque-2','situacao-0','concessoes-0','concessoes-1','concessoes-2'].map(id=>presentSeriesChart(filterChart(byId(id),'60'),'sfn',byId(id)));
  const figures={panorama:keyFigures('sfn','panorama',sfn),concessoes:keyFigures('sfn','concessoes',sfn)};
  const plan=deckPlan(charts,{figures});
  assert.deepEqual(plan.pages.map(page=>page.type),['cover','contents','divider','chart','chart','divider','chart','chart','notes']);
  assert.deepEqual(plan.pages.filter(page=>page.type==='chart').map(page=>page.charts.length),[1,2,1,2]);
  const {presentation}=buildPptx(charts,'Estatísticas de crédito',PptxGenJS,{figures});
  const zip=await JSZip.loadAsync(await repairPptxPackage(await presentation.write({outputType:'arraybuffer'})));
  const slide=n=>zip.file(`ppt/slides/slide${n}.xml`).async('string');
  const contents=await slide(2);
  assert.match(contents,/Sumário/);assert.match(contents,/Panorama/);assert.match(contents,/Concessões/);
  assert.match(contents,/<a:t>3<\/a:t>/);assert.match(contents,/<a:t>6<\/a:t>/,'contents point to the divider pages');
  const divider=await slide(3);
  assert.match(divider,/R\$ 7\.444 bi/);assert.match(divider,/Saldo de crédito do SFN/);
  const lead=await slide(4);
  assert.match(lead,/R\$ 7\.444 bi em set\/2026, \+8,6% em 12 meses/);assert.match(lead,/PANORAMA/);assert.match(lead,/Fonte: BCB/);assert.match(lead,/Estatísticas de crédito · 4<\/a:t>/);
  const notes=await slide(9);
  assert.match(notes,/Notas e fontes/);assert.match(notes,/zero é valor observado/);
  for(let n=1;n<=9;n++){
    const xml=await slide(n);
    assert.match(xml,/Calibri/);
    for(const [paragraph] of xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g))assert.ok((paragraph.match(/<a:pPr\b/g)||[]).length<=1,`slide ${n}: one paragraph style per paragraph`);
  }
});

test('position rulers rank the observed perimeter and put zero portfolios at the left end',()=>{
  const bank=catalog.institutions.find(entry=>entry.id==='5f6d3c0745685d8f');
  const rows=positionRulers(catalog,bank);
  const assets=rows.find(row=>row.key==='assets');
  const observed=catalog.institutions.filter(entry=>entry.perimeter===bank.perimeter&&entry.latestPeriod===catalog.latestPeriod&&typeof entry.latest.assets==='number'&&Number.isFinite(entry.latest.assets));
  assert.equal(assets.count,observed.length);
  assert.equal(assets.rank,observed.filter(entry=>entry.latest.assets>bank.latest.assets).length+1);
  assert.equal(assets.scale,'log');
  assert.ok(rows.every(row=>row.positions.every(position=>position>=0&&position<=1)));
  const scale=rulerScale([0,1,10,1000],'R$');
  assert.equal(scale.kind,'log');assert.equal(scale.at(0),0);assert.equal(scale.at(1000),1);
  const linear=rulerScale([-50,1,2,3,4,500],'%');
  assert.equal(linear.kind,'linear');assert.equal(linear.at(-50),0);assert.equal(linear.at(500),1);
});
