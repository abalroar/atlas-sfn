import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import {brandOfficeBlob,buildPptx,repairPptxPackage} from '../src/export.js';

test('dense charts have space for their legends and native small multiples preserve series, zeros, gaps and notes',async()=>{
  const many={id:'many',title:'Transações',unit:'mil transações',source:'BCB',note:'Definição publicada.',smallMultiples:true,series:Array.from({length:13},(_,index)=>({name:'Instrumento '+index,type:'line',data:[['2026-01-31',0],['2026-02-28',null],['2026-03-31',index+1]]}))};
  const {presentation,fileName}=buildPptx([many],'Pagamentos',PptxGenJS);
  const zip=await JSZip.loadAsync(await repairPptxPackage(await presentation.write({outputType:'arraybuffer'})));
  const slides=zip.file(/^ppt\/slides\/slide\d+\.xml$/);
  assert.equal(slides.length,3,'cover, one figure page and the notes page');
  assert.equal(zip.file(/^ppt\/charts\/chart\d+\.xml$/).length,13);
  const cover=await zip.file('ppt/slides/slide1.xml').async('string');
  const content=await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(await zip.file('ppt/slides/slide3.xml').async('string'),/Notas e fontes/);
  assert.match(cover,/Atlas/);assert.doesNotMatch(cover,/TOMA CONTA/);assert.match(fileName,/^Atlas_/);
  assert.match(content,/escala própria por série/);
  for(let index=0;index<13;index++)assert.ok(content.includes('Instrumento '+index));
  const notes=(await Promise.all(zip.file(/^ppt\/notesSlides\/notesSlide\d+\.xml$/).map(entry=>entry.async('string')))).join('');
  assert.match(notes,/Definição publicada/);
  const types=await zip.file('[Content_Types].xml').async('string');
  for(const [,part] of types.matchAll(/<Override\b[^>]*PartName="([^"]+)"/g))assert.ok(zip.file(part.slice(1)),part);
  for(const chart of zip.file(/^ppt\/charts\/chart\d+\.xml$/)){
    const xml=await chart.async('string');
    assert.match(xml,/<c:pt idx="0"><c:v>0<\/c:v><\/c:pt>/);
    assert.doesNotMatch(xml,/<c:pt idx="1"><c:v>0<\/c:v><\/c:pt>/);
    assert.match(xml,/Calibri/);
  }
  const dense={...many,smallMultiples:false};
  const normal=buildPptx([dense,dense,dense],'Denso',PptxGenJS);
  assert.deepEqual(normal.plan.pages.filter(page=>page.type==='chart').map(page=>page.charts.length),[1,1,1],'figures with many series take a full page');
  const light={...many,smallMultiples:false,series:many.series.slice(0,3)};
  const paired=buildPptx([light,light,light],'Leve',PptxGenJS);
  assert.deepEqual(paired.plan.pages.filter(page=>page.type==='chart').map(page=>page.charts.length),[1,2],'the first figure leads alone; the next ones pair up');
});

test('native financial Office files change only the project author, preserving every formula and financial part',async()=>{
  const zip=new JSZip();
  zip.file('docProps/core.xml','<cp:coreProperties><dc:creator>Toma Conta</dc:creator><dc:title>Instituição · Prudencial</dc:title></cp:coreProperties>');
  zip.file('xl/worksheets/sheet1.xml','<worksheet><c r="A1"><f>SUM(B1:C1)</f><v>0</v></c></worksheet>');
  zip.file('ppt/slides/slide1.xml','<a:tbl>Jun/2026 · -4 · N/D</a:tbl>');
  const blob=new Blob([await zip.generateAsync({type:'uint8array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const branded=await brandOfficeBlob(blob),result=await JSZip.loadAsync(await branded.arrayBuffer());
  assert.equal(branded.type,blob.type);
  assert.match(await result.file('docProps/core.xml').async('string'),/<dc:creator>Atlas<\/dc:creator>/);
  for(const part of ['xl/worksheets/sheet1.xml','ppt/slides/slide1.xml'])assert.equal(await result.file(part).async('string'),await zip.file(part).async('string'));
  assert.equal(await brandOfficeBlob(branded),branded);
});
