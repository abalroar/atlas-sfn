import {dateLabel,periodOf,chartCategories,axisUnits,seriesAxis,percentAxis,download} from './data.js';
import {displayScale,monthLabel,quantity,readable,retiredSeries,seriesColors,sourceLine} from './editorial.js';
import {dumbbellRows,ufTiles} from './chart-views.js';
const ATLAS_FALLBACK=['2C657F','B4553A','6BA5BD','7C3522','16323F','E3A48C','9AC4D4','9A8A80'];

const xmlText=value=>value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const xmlAttribute=(tag,name)=>xmlText(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]||'');
function partPath(owner,target){
 const parts=target.startsWith('/')?[]:owner.split('/').slice(0,-1);
 for(const part of target.split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);}
 return parts.join('/');
}
const relationshipsPath=part=>part.replace(/([^/]+)$/,'_rels/$1.rels');
function relationship(xml,id){return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map(match=>match[0]).find(tag=>xmlAttribute(tag,'Id')===id&&xmlAttribute(tag,'TargetMode')!=='External');}

// PptxGenJS 4.0.1 writes `value || ''` into ordinary chart worksheets,
// losing numeric zeros there while its native chart cache correctly keeps 0.
// Repair only those empty numeric cells identified by the cache's formula and
// point index. Missing observations, formulas and nonzero values stay intact.
// Embedded workbook font names follow the deck's Calibri; other styles stay intact.
// These XML forms belong to our generated OOXML, not to user-supplied documents.
export async function repairPptxChartWorkbooks(bytes){
 const {default:JSZip}=await import('jszip');
 const zip=await JSZip.loadAsync(bytes),workbooks=new Map();let changed=false;
 for(const entry of zip.file(/^ppt\/charts\/chart\d+\.xml$/)){
  const chart=await entry.async('string'),zeros=[];
  for(const [,reference] of chart.matchAll(/<c:numRef>([\s\S]*?)<\/c:numRef>/g)){
   const formula=xmlText(reference.match(/<c:f>([^<]*)<\/c:f>/)?.[1]||'');
   const range=/^('(?:[^']|'')*'|[^!]+)!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(formula);
   if(!range||range[2]!==range[4])continue;
   const sheet=range[1].replace(/^'|'$/g,'').replaceAll("''","'"),first=Number(range[3]),last=Number(range[5]);
   const cache=reference.match(/<c:numCache>([\s\S]*?)<\/c:numCache>/)?.[1]||'';
   for(const [,index,value] of cache.matchAll(/<c:pt idx="(\d+)">\s*<c:v>([^<]*)<\/c:v>\s*<\/c:pt>/g)){
    const row=first+Number(index);
    if(value.trim()!==''&&Number(value)===0&&row<=last)zeros.push({sheet,cell:range[2]+row});
   }
  }
  const externalId=chart.match(/<c:externalData\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels=zip.file(relationshipsPath(entry.name));
  if(!externalId||!rels)throw new Error('Não foi possível conferir a planilha do gráfico. Tente novamente.');
  const link=relationship(await rels.async('string'),externalId);
  if(!link)throw new Error('Planilha do gráfico não encontrada. Tente novamente.');
  const workbookPath=partPath(entry.name,xmlAttribute(link,'Target'));
  let state=workbooks.get(workbookPath);
  if(!state){
   const embedded=zip.file(workbookPath);
   if(!embedded)throw new Error('Planilha do gráfico não encontrada. Tente novamente.');
   const workbook=await JSZip.loadAsync(await embedded.async('uint8array'));
   const definition=await workbook.file('xl/workbook.xml').async('string');
   const links=await workbook.file('xl/_rels/workbook.xml.rels').async('string');
   state={workbook,sheets:new Map(),changed:false};
   const styleFile=workbook.file('xl/styles.xml');
   if(styleFile){
    const styles=await styleFile.async('string');
    const normalized=styles.replace(/(<fonts\b[^>]*>)([\s\S]*?)(<\/fonts>)/,(_all,open,fonts,close)=>open+fonts.replace(/(<name\b[^>]*\bval=")[^"]*(")/g,'$1Calibri$2')+close);
    if(normalized!==styles){workbook.file('xl/styles.xml',normalized);state.changed=true;changed=true;}
   }
   for(const [tag] of definition.matchAll(/<sheet\b[^>]*\/>/g)){
    const sheetLink=relationship(links,xmlAttribute(tag,'r:id'));
    if(sheetLink)state.sheets.set(xmlAttribute(tag,'name'),{path:partPath('xl/workbook.xml',xmlAttribute(sheetLink,'Target')),xml:null,changed:false});
   }
   workbooks.set(workbookPath,state);
  }
  for(const {sheet,cell} of zeros){
   const target=state.sheets.get(sheet);
   if(!target)throw new Error('A referência do gráfico não corresponde à planilha. Tente novamente.');
   target.xml??=await state.workbook.file(target.path).async('string');
   target.xml=target.xml.replace(new RegExp(`<c\\b[^>]*\\br="${cell}"[^>]*>[\\s\\S]*?<\\/c>`),element=>{
    const type=xmlAttribute(element.slice(0,element.indexOf('>')+1),'t');
    if((type&&type!=='n')||/<f\b/.test(element))return element;
    const repaired=element.replace(/<v\s*\/>|<v>\s*<\/v>/,'<v>0</v>');
    if(repaired!==element){target.changed=true;state.changed=true;changed=true;}
    return repaired;
   });
  }
 }
 if(!changed)return bytes;
 for(const [path,state] of workbooks){
  if(!state.changed)continue;
  for(const sheet of state.sheets.values())if(sheet.changed)state.workbook.file(sheet.path,sheet.xml);
  zip.file(path,await state.workbook.generateAsync({type:'uint8array',compression:'DEFLATE'}));
 }
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

// PptxGenJS 4 declares one slide master per slide while writing only the shared master.
// Remove only those dangling declarations; relationships and slide content stay intact.
export async function repairPptxPackage(bytes){
 const repaired=await repairPptxChartWorkbooks(bytes);
 const {default:JSZip}=await import('jszip'),zip=await JSZip.loadAsync(repaired);
 const source=await zip.file('[Content_Types].xml').async('string');
 const normalized=source.replace(/<Override\b[^>]*PartName="(\/ppt\/slideMasters\/slideMaster\d+\.xml)"[^>]*\/>/g,(entry,path)=>zip.file(path.slice(1))?entry:'');
 if(normalized===source)return repaired;
 zip.file('[Content_Types].xml',normalized);
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

/** Brand only the native file metadata; the original financial renderer owns every sheet and slide. */
export async function brandOfficeBlob(blob){
 const {default:JSZip}=await import('jszip'),zip=await JSZip.loadAsync(await blob.arrayBuffer());
 const part=zip.file('docProps/core.xml');
 if(!part)return blob;
 const original=await part.async('string'),branded=original.replace(/(<dc:creator>)Toma Conta(<\/dc:creator>)/g,'$1Atlas$2');
 if(branded===original)return blob;
 zip.file('docProps/core.xml',branded);
 return new Blob([await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})],{type:blob.type});
}
export function chartDataForPptx(chart){const dates=chartCategories(chart);return chart.series.map(s=>({name:s.name,labels:dates.map(dateLabel),values:dates.map(d=>{const v=s.data.find(p=>p[0]===d)?.[1];return v==null?null:percentAxis(chart,seriesAxis(chart,s))?v/100:v;})}));}

/** Formato do eixo: % para percentuais; nos demais, a escala de exibição divide só o rótulo (a planilha mantém a unidade publicada). */
function axisFormat(chart,axis){
 if(percentAxis(chart,axis))return '0.0%';
 const values=chart.series.filter(s=>seriesAxis(chart,s)===axis).flatMap(s=>s.data.map(p=>p[1])),scale=displayScale(axisUnits(chart)[axis],values);
 if(scale.factor!==1)return scale.excel;
 return Math.max(0,...values.filter(v=>typeof v==='number'&&Number.isFinite(v)).map(Math.abs))>=1000?'#,##0':'#,##0.0';
}
export function addChartForPptx(slide,types,chart,options={}){
 const {colors,kind:forced,...rest}=options;
 const prepared=chartDataForPptx(chart),groups=[];
 chart.series.forEach((series,index)=>{
  const axis=seriesAxis(chart,series),type=forced||(series.type==='bar'?'bar':'line');let group=groups.find(g=>g.axis===axis&&g.kind===type);
  if(!group){group={axis,kind:type,type:types[type],data:[],options:{secondaryValAxis:axis===1,secondaryCatAxis:axis===1,chartColors:[]}};groups.push(group);}
  group.data.push(prepared[index]);group.options.chartColors.push(colors?.[index]||ATLAS_FALLBACK[index%ATLAS_FALLBACK.length]);
 });
 const axes=axisUnits(chart);
 const opts={...rest,dataLabelFontFace:'Calibri',valAxisLabelFormatCode:axisFormat(chart,0),showValAxisTitle:false,lineDataSymbol:chartCategories(chart).length===1?'circle':'none',lineDataSymbolSize:3,valGridLine:{color:'E0E6E3',size:.5},valAxisLineColor:'CFD8D6',catAxisLineColor:'CFD8D6',valAxisLabelColor:'4A6670',catAxisLabelColor:'4A6670',legendColor:'4A6670',valAxisLineSize:.5,catAxisLineSize:.5};
 if(colors&&groups.length===1)opts.chartColors=groups[0].options.chartColors;
 if(axes.length>1){delete opts.valAxisMinVal;opts.valAxes=axes.map((unit,axis)=>({showValAxisTitle:false,valAxisLabelFormatCode:axisFormat(chart,axis),valAxisLabelFontFace:'Calibri',valAxisLabelFontSize:7,valGridLine:axis===0?{color:'E0E6E3',size:.5}:{style:'none'},axisPos:axis===1?'r':'l'}));opts.catAxes=[{catAxisLabelPos:'low'},{catAxisHidden:true,catAxisLabelPos:'none'}];}
 const native=groups.map(({axis,kind,...group})=>group);
 if(native.length===1)slide.addChart(native[0].type,native[0].data,opts);else slide.addChart(native,opts);
}
export function coverageForCharts(charts){const ready=charts.filter(c=>c.series.some(s=>s.data.some(p=>p[1]!=null&&Number.isFinite(Number(p[1])))));return {total:charts.length,ready,missing:charts.filter(c=>!ready.includes(c)),complete:ready.length===charts.length};}
export function chartTitleForPptx(c){const title=c.title.replace(/<[^>]*>/g,'');return c.section&&(/mercadoimobiliario/i.test(c.source)||/^(contratacao_|estoque_|imoveis_)/.test(c.id))?`${title.replace(/ · P[FJ]$/,'')} · ${c.section}`:title;}

/* ---------- Diagramação editorial ---------- */

// Slide 16:9 de 13,33 × 7,5 pol. Margens de 0,45 pol.; Calibri; fundo branco; laranja Itaú BBA.
const W=13.333,M=.45,BODY=W-2*M;
// Paleta do Atlas: terracota como acento, tinta azul-petróleo escura no texto.
const ORANGE='B4553A',INK='16323F',GREY='4A6670',SOFT='8A9AA2';
const font={fontFace:'Calibri'};
const plain=value=>String(value??'').replace(/<[^>]*>/g,'').replaceAll('&amp;','&');
const isLevel=unit=>!/%|Δ|variação|meses|p\.p\./i.test(unit||'');

function chartUnits(chart){
 if(chart.view==='matrix')return chart.matrix.kind==='rate'?`% da carteira · ${chart.matrix.label}`:`% do total de transações do produto · ${chart.matrix.label}`;
 const units=axisUnits(chart).map((unit,axis)=>displayScale(unit,chart.series.filter(s=>seriesAxis(chart,s)===axis).flatMap(s=>s.data.map(p=>p[1]))).unit);
 if(chart.view==='dumbbell'){const rows=dumbbellRows(chart);return `${units[0]} · ${rows.label} contra ${rows.earlierLabel}`;}
 return units.length>1?`${units[0]} (esq.) / ${units[1]} (dir.)`:units[0];
}
function chartPeriod(chart){return chart.view==='matrix'?chart.matrix.label:periodOf(chart);}
function chartContext(chart){return `${chartUnits(chart)} · ${chartPeriod(chart)}`;}
function slideNotes(charts){return charts.map(chart=>[chartTitleForPptx(chart),chart.reading?.text||'',chartContext(chart),chart.note||'',chart.smallMultiples?'Escala própria por série.':''].filter(Boolean).join('\n')).join('\n\n');}

const nativeOptions={showTitle:false,showLegend:true,legendPos:'b',legendFontSize:9,legendFontFace:'Calibri',catAxisLabelFontFace:'Calibri',catAxisLabelFontSize:9,valAxisLabelFontFace:'Calibri',valAxisLabelFontSize:9,showValue:false,lineSize:2,showCatName:false,catAxisLabelRotate:0,showBorder:false,showSerName:false,showLeaderLines:false,barDir:'col',displayBlanksAs:'gap',showLegendKey:false,showPercent:false};

function frequency(chart,width){const n=chartCategories(chart).length;return Math.max(1,Math.ceil(n/Math.max(4,Math.floor(width*1.1))));}
function levelFloor(chart){
 if(axisUnits(chart).length>1||!isLevel(axisUnits(chart)[0]))return {};
 const values=chart.series.flatMap(s=>s.data.map(p=>p[1])).filter(v=>typeof v==='number'&&Number.isFinite(v));
 return values.length&&values.every(v=>v>=0)?{valAxisMinVal:0}:{};
}

function standardChart(slide,p,chart,box){
 const colors=seriesColors(chart,'pptx'),area=chart.view==='area-share'||chart.view==='area-stack';
 addChartForPptx(slide,p.ChartType,chart,{...nativeOptions,...box,colors,showLegend:chart.series.length>1,lineSize:box.w>8?2.25:1.75,
  catAxisLabelFrequency:frequency(chart,box.w),barGrouping:area||chart.stacked?'stacked':'clustered',barGapWidthPct:40,...(area?{kind:'area'}:{}),
  ...levelFloor(chart),...(chart.view==='area-share'?{valAxisMaxVal:1,valAxisMinVal:0}:{})});
}

function splitChart(slide,p,chart,box){
 const units=axisUnits(chart),colors=seriesColors(chart,'pptx');
 const bars={...chart,axes:[units[0]],unit:units[0],series:chart.series.filter(s=>seriesAxis(chart,s)===0).map(s=>({...s,axis:0}))};
 const lines={...chart,axes:[units[1]],unit:units[1],series:chart.series.filter(s=>seriesAxis(chart,s)===1).map(s=>({...s,axis:0}))};
 const top=box.h*.6;
 slide.addText(units[0],{...font,x:box.x,y:box.y-.02,w:3,h:.2,fontSize:8,color:GREY});
 addChartForPptx(slide,p.ChartType,bars,{...nativeOptions,x:box.x,y:box.y+.15,w:box.w,h:top-.15,colors:[colors[chart.series.indexOf(chart.series.find(s=>seriesAxis(chart,s)===0))]],showLegend:false,catAxisHidden:true,valAxisMinVal:0,barGapWidthPct:40});
 slide.addText(`${lines.series[0]?.name||''} · ${units[1]}`,{...font,x:box.x,y:box.y+top+.02,w:4,h:.2,fontSize:8,color:GREY});
 addChartForPptx(slide,p.ChartType,lines,{...nativeOptions,x:box.x,y:box.y+top+.2,w:box.w,h:box.h-top-.2,colors:['16323F'],showLegend:false,lineSize:1.75,catAxisLabelFrequency:frequency(chart,box.w)});
}

function dumbbellChart(slide,p,chart,box){
 const {rows,label,earlierLabel}=dumbbellRows(chart),ordered=rows.slice().reverse(),unit=axisUnits(chart)[0];
 const bars={...chart,axes:[unit],unit,stacked:false,series:[{name:earlierLabel,type:'bar',data:ordered.map(r=>[r.name,r.before])},{name:label,type:'bar',data:ordered.map(r=>[r.name,r.now])}]};
 addChartForPptx(slide,p.ChartType,bars,{...nativeOptions,...box,barDir:'bar',barGrouping:'clustered',barGapWidthPct:60,colors:['C9D1D0',ORANGE],showLegend:true,legendPos:'b',showValue:true,dataLabelFontSize:8,dataLabelColor:'404040',dataLabelFormatCode:percentAxis(bars,0)?'0.0%':'#,##0.0',catAxisLabelFontSize:9,catAxisLabelPos:'low'});
}

function tileMap(slide,chart,box){
 const {tiles,min,max,ramp,cols,rows}=ufTiles(chart,'pptx'),unit=chart.unit||'';
 const size=Math.min((box.h-.5)/rows,(box.w*.5)/cols)-.04,gap=.04,left=box.x+(box.w-(cols*(size+gap)))/2;
 for(const tile of tiles){
  const x=left+tile.col*(size+gap),y=box.y+tile.row*(size+gap);
  slide.addShape('rect',{x,y,w:size,h:size,fill:{color:tile.color},line:{color:'FFFFFF',width:.5}});
  slide.addText(tile.uf,{...font,x:x+.03,y:y+.02,w:size-.06,h:size*.4,fontSize:9,bold:true,color:tile.dark?'FFFFFF':INK,valign:'top',margin:0});
  slide.addText(tile.value==null?'N/D':readable(tile.value),{...font,x:x+.03,y:y+size*.5,w:size-.06,h:size*.45,fontSize:9,color:tile.dark?'FFFFFF':INK,align:'right',valign:'bottom',margin:0});
 }
 const ly=box.y+rows*(size+gap)+.15,lx=left;
 slide.addText(quantity(min,unit),{...font,x:lx-1.05,y:ly-.03,w:1,h:.22,fontSize:9,color:GREY,align:'right',margin:0});
 ramp.forEach((color,i)=>slide.addShape('rect',{x:lx+i*.35,y:ly,w:.35,h:.14,fill:{color},line:{color,width:0}}));
 slide.addText(quantity(max,unit),{...font,x:lx+ramp.length*.35+.08,y:ly-.03,w:1.2,h:.22,fontSize:9,color:GREY,margin:0});
}

function matrixTable(slide,chart,box){
 const {matrix}=chart,rate=matrix.kind==='rate',columns=matrix.columns||matrix.channels;
 const values=matrix.rows.flatMap(row=>columns.map(c=>row.values[c])).filter(v=>typeof v==='number'&&Number.isFinite(v)),low=Math.min(...values),high=Math.max(...values);
 const level=v=>rate?(v-low)/(high-low||1):v/100;
 const shade=value=>{if(value==null)return 'FFFFFF';const t=Math.min(1,.06+level(value)*.94),mix=(a,b)=>Math.round(a+(b-a)*t).toString(16).padStart(2,'0');return mix(255,44)+mix(255,101)+mix(255,127);};
 const text=v=>v==null?'N/D':rate?readable(v)+'%':v>0&&v<.5?'<1%':`${Math.round(v)}%`;
 const head=[{text:matrix.head||'',options:{bold:true,color:GREY}},...columns.map(c=>({text:matrix.short?.[c]||c,options:{color:GREY,align:'center'}})),...(matrix.totalLabel?[{text:matrix.totalLabel,options:{color:GREY,align:'right'}}]:[])];
 const body=matrix.rows.map(row=>[{text:row.label,options:{color:INK}},...columns.map(c=>{const v=row.values[c];return {text:text(v),options:{align:'center',fill:{color:shade(v)},color:v!=null&&level(v)>=.55?'FFFFFF':INK}};}),...(matrix.totalLabel?[{text:quantity(row.total,matrix.unit),options:{align:'right',color:GREY}}]:[])]);
 const total=matrix.totalLabel?1.9:0,first=2.6,rest=(box.w-first-total)/columns.length;
 slide.addTable([head,...body],{...font,x:box.x,y:box.y,w:box.w,colW:[first,...columns.map(()=>rest),...(total?[total]:[])],fontSize:10,rowH:Math.min(.42,box.h/(body.length+1)),border:{type:'solid',pt:1,color:'FFFFFF'},margin:.04,valign:'middle'});
 if(matrix.columnNote)slide.addText(`Colunas: ${matrix.columnNote}.`,{...font,x:box.x,y:box.y+Math.min(.42,box.h/(body.length+1))*(body.length+1)+.1,w:box.w,h:.25,fontSize:9,color:SOFT,margin:0});
}

function multiplesChart(slide,p,chart,box){
 const colors=seriesColors(chart,'pptx'),active=chart.series.map((series,index)=>({series,index})).filter(({series})=>!retiredSeries(series));
 const columns=active.length>8?4:3,rows=Math.ceil(active.length/columns),width=box.w/columns,gap=.25,height=Math.min(2.4,box.h/rows);
 active.forEach(({series,index},slot)=>{
  const x=box.x+(slot%columns)*width,y=box.y+Math.floor(slot/columns)*height,observed=series.data.some(([,v])=>v!=null&&Number.isFinite(v));
  const scale=displayScale(chart.unit,series.data.map(point=>point[1]));
  slide.addText(`${series.name} · ${scale.unit}${observed?'':' · N/D'}`,{...font,x,y,w:width-gap,h:.25,fontSize:10,bold:true,color:INK,margin:0});
  const values=new Map(series.data),aligned={...series,data:chartCategories(chart).map(date=>[date,values.get(date)??null])};
  addChartForPptx(slide,p.ChartType,{...chart,series:[aligned]},{...nativeOptions,x,y:y+.27,w:width-gap,h:height-.37,showLegend:false,catAxisLabelFontSize:7,valAxisLabelFontSize:7,lineSize:1.5,catAxisLabelFrequency:Math.max(1,Math.ceil(chartCategories(chart).length/4)),colors:[colors[index]],...(series.data.every(([,v])=>v==null||v>=0)?{valAxisMinVal:0}:{})});
 });
}

function renderChart(slide,p,chart,box){
 if(chart.view==='matrix')return matrixTable(slide,chart,box);
 if(chart.view==='tiles')return tileMap(slide,chart,box);
 if(chart.view==='dumbbell')return dumbbellChart(slide,p,chart,box);
 if(chart.view==='split')return splitChart(slide,p,chart,box);
 if(chart.smallMultiples)return multiplesChart(slide,p,chart,box);
 return standardChart(slide,p,chart,box);
}

function wide(chart){return ['matrix','tiles','dumbbell'].includes(chart.view)||chart.smallMultiples||chart.series.length>8;}

/** Plano de páginas: capa, sumário, divisória por assunto, páginas de gráfico (inteira ou em par), notas e anexo. */
export function deckPlan(charts,{figures={},profile=null}={}){
 const topics=[];
 for(const chart of charts){
  const id=chart.topic||'__all',label=chart.topicLabel||'';
  let topic=topics.find(entry=>entry.id===id);
  if(!topic){topic={id,label,charts:[]};topics.push(topic);}
  topic.charts.push(chart);
 }
 const sectioned=topics.length>1||topics.some(topic=>figures[topic.id]?.length);
 const pages=[{type:'cover'}];
 if(profile?.rows?.length)pages.push({type:'profile'});
 if(topics.length>1)pages.push({type:'contents'});
 topics.forEach((topic,index)=>{
  // Divisória só quando o assunto tem números-chave; sem eles, o sumário aponta para o primeiro gráfico.
  if(sectioned&&figures[topic.id]?.some(entry=>entry.value!=null))pages.push({type:'divider',topic,index});
  topic.page=pages.length+(pages.at(-1)?.type==='divider'?0:1);
  let pair=null;
  topic.charts.forEach((chart,position)=>{
   if(position===0||wide(chart)){pages.push({type:'chart',topic,charts:[chart],full:true});pair=null;return;}
   if(pair&&pair.charts.length<2){pair.charts.push(chart);return;}
   pair={type:'chart',topic,charts:[chart],full:false};pages.push(pair);
  });
  for(const page of pages)if(page.type==='chart'&&page.charts.length===1&&!page.full&&page.topic===topic)page.full=true;
 });
 const notes=[...new Map(charts.filter(chart=>chart.note).map(chart=>[chart.note,{text:plain(chart.note),charts:[]}])).values()];
 for(const chart of charts)if(chart.note)notes.find(note=>note.text===plain(chart.note)).charts.push(plain(chart.title));
 for(let index=0;index<notes.length;index+=7)pages.push({type:'notes',notes:notes.slice(index,index+7)});
 if(!notes.length)pages.push({type:'notes',notes:[]});
 return {topics,pages,sectioned};
}

// Rodapé sem fonte: a fonte aparece uma vez, na página de notas.
function footer(slide,{page,title}){
 slide.addText('Atlas',{...font,x:M,y:7.05,w:.45,h:.25,fontSize:8,bold:true,color:ORANGE,margin:0});
 slide.addText(title,{...font,x:M+.45,y:7.05,w:BODY-1.5,h:.25,fontSize:8,color:SOFT,margin:0});
 slide.addText(String(page),{...font,x:W-M-1,y:7.05,w:1,h:.25,fontSize:8,color:SOFT,align:'right',margin:0});
}

// O PowerPoint não reduz a fonte ao abrir o arquivo: o tamanho sai do comprimento do texto.
const fitSize=(text,width,size,min)=>{let s=size;while(s>min&&String(text).length*s*.0078>width*2)s-=1;return s;};
function heading(slide,{kicker,title,subtitle,size=22}){
 if(kicker)slide.addText(kicker,{...font,x:M,y:.32,w:BODY,h:.25,fontSize:11,bold:true,color:ORANGE,margin:0});
 const fitted=fitSize(title,BODY,size,15),oneLine=String(title).length*fitted*.0078<=BODY;
 slide.addText(title,{...font,x:M,y:.58,w:BODY,h:.8,fontSize:fitted,bold:true,color:INK,valign:oneLine?'middle':'top',margin:0});
 if(subtitle)slide.addText(subtitle,{...font,x:M,y:1.4,w:BODY,h:.28,fontSize:11,color:GREY,margin:0});
}

export function buildPptx(charts,title,PptxGenJS,deck={}){
 // Alternâncias do site (quantidade/valor, R$/%, PF/PJ) viram páginas próprias no arquivo.
 charts=charts.flatMap(chart=>chart.alternatives?chart.alternatives.map(option=>({...option.chart,title:`${plain(chart.title)} · ${option.label}`,topic:chart.topic,topicLabel:chart.topicLabel})):[chart]);
 const coverage=coverageForCharts(charts),ready=coverage.ready;if(!ready.length)throw new Error('Nenhum gráfico possui dados no intervalo selecionado.');
 const p=new PptxGenJS();p.layout='LAYOUT_WIDE';p.author='Atlas';p.subject='Dados oficiais do Banco Central';p.title=title;p.company='Atlas';p.lang='pt-BR';p.theme={headFontFace:'Calibri',bodyFontFace:'Calibri',lang:'pt-BR'};
 const figures=deck.figures||{},plan=deckPlan(ready,{figures,profile:deck.profile});
 const latest=ready.map(chart=>chart.view==='matrix'?chart.matrix.date:periodOf(chart).split(' a ').at(-1)).filter(value=>/^\d{2}\/\d{4}$/.test(value)).map(value=>value.slice(3)+'-'+value.slice(0,2)).sort().at(-1);
 const short=title.length>48?title.slice(0,46)+'…':title;
 let number=0;
 const add=()=>{const slide=p.addSlide();slide.background={color:'FFFFFF'};number+=1;return slide;};
 for(const page of plan.pages){
  if(page.type==='cover'){
   const slide=add();
   slide.addShape('rect',{x:M,y:.55,w:.7,h:.09,fill:{color:ORANGE},line:{color:ORANGE,width:0}});
   slide.addText('Atlas',{...font,x:M,y:.72,w:6,h:.4,fontSize:16,bold:true,color:ORANGE,margin:0});
   slide.addText(title,{...font,x:M,y:2.2,w:BODY,h:1.3,fontSize:40,bold:true,color:INK,valign:'bottom',margin:0,fit:'shrink'});
   const count=coverage.complete?`${ready.length} gráficos`:`Exportação parcial · ${ready.length} de ${charts.length} gráficos`;
   slide.addText(`${count}${plan.topics.length>1?` · ${plan.topics.length} assuntos`:''}${latest?` · dados até ${monthLabel(latest+'-01')}`:''}`,{...font,x:M,y:3.65,w:BODY,h:.4,fontSize:16,color:GREY,margin:0});
   slide.addText('Gráficos nativos e editáveis, com leitura, unidade e período. Fonte e definições na página final.'+(!coverage.complete?' Gráficos sem dados no intervalo constam do anexo.':''),{...font,x:M,y:6.55,w:BODY,h:.4,fontSize:10,color:SOFT,margin:0});
   continue;
  }
  if(page.type==='profile'){
   // Ficha: régua de cada indicador contra o perímetro, em formas nativas editáveis.
   const slide=add(),{rows,perimeter}=deck.profile;
   heading(slide,{kicker:perimeter==='Prudencial'?'Entre os conglomerados prudenciais':`Perímetro ${perimeter}`,title:`${deck.profile.title} entre os pares`,subtitle:`${rows[0].periodLabel} · cada traço é uma instituição com dado na competência; o ponto laranja é ${deck.profile.title}`});
   const cols=rows.length>4?2:1,per=Math.ceil(rows.length/cols),cw=(BODY-.7*(cols-1))/cols,rh=Math.min(1.25,5.1/per);
   rows.forEach((row,index)=>{
    const x=M+Math.floor(index/per)*(cw+.7),y=1.95+(index%per)*rh,track=y+.48;
    slide.addText(`${row.label} · ${row.unit}`,{...font,x,y,w:cw-1.6,h:.3,fontSize:11,bold:true,color:INK,margin:0});
    slide.addText(row.valueText,{...font,x:x+cw-1.6,y:y-.05,w:1.6,h:.38,fontSize:18,bold:true,color:INK,align:'right',margin:0});
    slide.addShape('line',{x,y:track,w:cw,h:0,line:{color:'CFD8D6',width:.75}});
    for(const position of row.positions)slide.addShape('line',{x:x+position*cw,y:track-.09,w:0,h:.18,line:{color:'9A9B9C',width:.5,transparency:55}});
    if(row.position!=null)slide.addShape('ellipse',{x:x+row.position*cw-.08,y:track-.08,w:.16,h:.16,fill:{color:ORANGE},line:{color:'FFFFFF',width:1}});
    slide.addText(row.minText,{...font,x,y:track+.13,w:1.6,h:.22,fontSize:8,color:SOFT,margin:0});
    slide.addText(row.rank?`${row.rank}ª de ${row.count} · mediana ${row.medianText}`:'Sem dado nesta competência',{...font,x:x+cw/2-1.6,y:track+.13,w:3.2,h:.22,fontSize:9,color:GREY,align:'center',margin:0});
    slide.addText(row.maxText,{...font,x:x+cw-1.6,y:track+.13,w:1.6,h:.22,fontSize:8,color:SOFT,align:'right',margin:0});
   });
   slide.addText('Ativo e carteira em escala logarítmica; índices entre os percentis 2 e 98, com os extremos encostados nas pontas.',{...font,x:M,y:6.7,w:BODY,h:.25,fontSize:8,color:SOFT,margin:0});
   footer(slide,{page:number,title:short});
   continue;
  }
  if(page.type==='contents'){
   const slide=add();heading(slide,{kicker:'Atlas',title:'Sumário',size:26});
   const rows=plan.topics.length,columns=rows>9?2:1,perColumn=Math.ceil(rows/columns),cw=(BODY-.6*(columns-1))/columns;
   plan.topics.forEach((topic,index)=>{
    const col=Math.floor(index/perColumn),row=index%perColumn,x=M+col*(cw+.6),y=1.9+row*.5;
    slide.addText(String(index+1).padStart(2,'0'),{...font,x,y,w:.5,h:.4,fontSize:13,bold:true,color:ORANGE,margin:0});
    slide.addText(topic.label||title,{...font,x:x+.55,y,w:cw-2.9,h:.4,fontSize:13,bold:true,color:INK,margin:0});
    slide.addText(`${topic.charts.length} ${topic.charts.length===1?'gráfico':'gráficos'}`,{...font,x:x+cw-2.3,y,w:1.4,h:.4,fontSize:11,color:SOFT,align:'right',margin:0});
    slide.addText(String(topic.page),{...font,x:x+cw-.8,y,w:.8,h:.4,fontSize:13,color:GREY,align:'right',margin:0});
   });
   footer(slide,{page:number,title:short});
   continue;
  }
  if(page.type==='divider'){
   const slide=add(),topic=page.topic,list=(figures[topic.id]||[]).filter(entry=>entry.value!=null).slice(0,3);
   slide.addText(String(page.index+1).padStart(2,'0'),{...font,x:M,y:.9,w:2,h:.5,fontSize:18,bold:true,color:ORANGE,margin:0});
   slide.addText(topic.label||title,{...font,x:M,y:1.4,w:BODY,h:1,fontSize:38,bold:true,color:INK,margin:0,fit:'shrink'});
   slide.addText(`${topic.charts.length} ${topic.charts.length===1?'gráfico':'gráficos'}`,{...font,x:M,y:2.4,w:BODY,h:.3,fontSize:12,color:GREY,margin:0});
   const cw=BODY/3;
   list.forEach((entry,i)=>{
    const x=M+i*cw;
    slide.addText(entry.label,{...font,x,y:3.45,w:cw-.35,h:.5,fontSize:11,color:GREY,valign:'top',margin:0});
    slide.addText(entry.text,{...font,x,y:3.95,w:cw-.35,h:.7,fontSize:entry.text.length>18?22:entry.text.length>13?26:30,bold:true,color:INK,margin:0});
    slide.addText(`${entry.when}${entry.deltaText?` · ${entry.deltaText} em 12 meses`:''}`,{...font,x,y:4.7,w:cw-.35,h:.3,fontSize:11,color:GREY,margin:0});
   });
   // Índice do assunto: os gráficos na ordem em que aparecem.
   const names=topic.charts.map(chart=>plain(chart.title)),half=Math.ceil(names.length/2),lines=names.length>8?[names.slice(0,half),names.slice(half)]:[names];
   lines.forEach((column,i)=>slide.addText(column.map(name=>({text:name,options:{breakLine:true}})),{...font,x:M+i*(BODY/2),y:5.35,w:BODY/2-.3,h:1.5,fontSize:names.length>12?8:9,color:GREY,valign:'top',margin:0,paraSpaceAfter:1}));
   footer(slide,{page:number,title:short});
   continue;
  }
  if(page.type==='chart'){
   const slide=add();slide.addNotes(slideNotes(page.charts));
   const kicker=page.topic.label||'';
   if(page.full){
    const chart=page.charts[0];
    heading(slide,{kicker,title:chart.reading?.text||chartTitleForPptx(chart),subtitle:`${chartTitleForPptx(chart)} · ${chartUnits(chart)}${chart.smallMultiples?' · escala própria por série':''} · ${chartPeriod(chart)}`});
    renderChart(slide,p,chart,{x:M,y:1.8,w:BODY,h:5.0});
   }else{
    if(kicker)slide.addText(kicker,{...font,x:M,y:.32,w:BODY,h:.25,fontSize:11,bold:true,color:ORANGE,margin:0});
    const cw=(BODY-.5)/2;
    page.charts.forEach((chart,i)=>{
     const x=M+i*(cw+.5);
     const text=chart.reading?.text||chartTitleForPptx(chart);
     slide.addText(text,{...font,x,y:.62,w:cw,h:.82,fontSize:fitSize(text,cw*1.45,15,11),bold:true,color:INK,valign:'top',margin:0});
     slide.addText(`${chartTitleForPptx(chart)} · ${chartUnits(chart)} · ${chartPeriod(chart)}`,{...font,x,y:1.48,w:cw,h:.3,fontSize:9,color:GREY,margin:0});
     renderChart(slide,p,chart,{x,y:1.85,w:cw,h:4.95});
    });
   }
   footer(slide,{page:number,title:short});
   continue;
  }
  if(page.type==='notes'){
   const slide=add();heading(slide,{kicker:'Atlas',title:'Notas e fontes',size:24});
   const general=['N/D indica ausência de dado publicado; zero é valor observado.','Quando o rótulo indica bilhões ou milhões, a planilha de cada gráfico mantém a unidade publicada pelo Banco Central.','As leituras comparam o último dado com o mesmo período do ano anterior, quando ele existe.'];
   // Cada corrida fecha o próprio parágrafo (breakLine), como o OOXML exige.
   const items=[{text:`Fonte: ${sourceLine(ready)}.`,options:{bold:true,color:INK,fontSize:11,breakLine:true,paraSpaceAfter:12}},...page.notes.flatMap(note=>[{text:note.charts.join(' · '),options:{bold:true,color:INK,fontSize:10,breakLine:true}},{text:note.text,options:{color:GREY,fontSize:10,breakLine:true,paraSpaceAfter:9}}]),{text:general.join(' '),options:{color:SOFT,fontSize:9,breakLine:true}}];
   slide.addText(items,{...font,x:M,y:1.75,w:BODY,h:5.1,valign:'top',margin:0});
   footer(slide,{page:number,title:short});
  }
 }
 for(let i=0;i<coverage.missing.length;i+=12){const slide=add();heading(slide,{kicker:'Atlas',title:'Cobertura da exportação parcial',subtitle:'Gráficos sem observações no intervalo selecionado:'});coverage.missing.slice(i,i+12).forEach((c,j)=>slide.addText(`${c.section||'Seção não informada'} · ${plain(c.title)}`,{...font,x:M,y:1.85+j*.4,w:BODY,h:.36,fontSize:12,color:INK,margin:0}));footer(slide,{page:number,title:short});}
 const fileName='Atlas_'+(coverage.complete?'':'Parcial_')+title.replace(/[^\p{L}\p{N}]+/gu,'_')+'.pptx';
 return {presentation:p,coverage,fileName,plan};
}
export async function exportPptx(charts,title='Atlas',deck={}){
 const {default:PptxGenJS}=await import('pptxgenjs');const {presentation,coverage,fileName}=buildPptx(charts,title,PptxGenJS,deck);
 const bytes=await repairPptxPackage(await presentation.write({outputType:'arraybuffer'}));
 download(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}),fileName);
 return {total:coverage.total,exported:coverage.ready.length,complete:coverage.complete,missing:coverage.missing.map(c=>({id:c.id,title:c.title,section:c.section}))};
}
