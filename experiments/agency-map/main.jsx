import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as maplibregl from 'maplibre-gl';
import {Search,X,Plus,Minus,Play,Pause,ArrowUpRight,Info,ArrowLeft,ArrowRight} from 'lucide-react';
import points from './points.json';
import states from './states.json';
import municipalities from './municipalities.json';
import catalog from './institutions.json';
import cityNames from './city-names.json';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

const normalize=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const pretty=s=>s.toLocaleLowerCase('pt-BR').replace(/(^|[\s/-])\p{L}/gu,c=>c.toLocaleUpperCase('pt-BR'));
const cityName=f=>cityNames[f.properties.ibgeCode]||pretty(f.properties.city);
const branchName=f=>{const raw=f.properties.name.split('-')[0].trim();return normalize(raw)===normalize(f.properties.city)?cityName(f):pretty(raw)};
const analysis='https://matheusprat.es/atlas-sfn/?view=institutions&bank=';
const STOPS=[
 {name:'Brasil',center:[-51,-14.5],zoom:3.35},
 {name:'São Paulo',center:[-46.641,-23.559],zoom:11.8},
 {name:'Centro',center:[-46.6377,-23.546],zoom:14.4},
 {name:'Rio de Janeiro',center:[-43.181,-22.908],zoom:13},
];
const coordinatesOf=f=>f.geometry.coordinates.join(',');
const total=points.features.length;

function BankSearch(){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(0),ref=useRef(null);
 const rows=useMemo(()=>{const q=normalize(query.trim());return q?catalog.institutions.filter(b=>normalize([b.displayName,b.name,...(b.aliases||[])].join(' ')).includes(q)).sort((a,b)=>{const score=v=>[v.displayName,...(v.aliases||[])].some(n=>normalize(n)===q)?0:normalize(v.displayName).startsWith(q)?1:2;return score(a)-score(b)}).slice(0,5):[]},[query]);
 useEffect(()=>{const close=e=>{if(!ref.current?.contains(e.target))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
 return <div className="bank-search" ref={ref}><Search size={17}/><input role="combobox" aria-label="Analisar instituição" placeholder="Analisar instituição" value={query} aria-expanded={open&&!!query} aria-controls="bank-results" aria-autocomplete="list" aria-activedescendant={open&&rows[active]?'bank-'+active:undefined} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(0)}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='ArrowDown'){e.preventDefault();setActive(v=>Math.min(rows.length-1,v+1))}if(e.key==='ArrowUp'){e.preventDefault();setActive(v=>Math.max(0,v-1))}if(e.key==='Enter'&&rows[active])location.href=analysis+rows[active].id}}/>{query&&<button aria-label="Limpar instituição" onClick={()=>setQuery('')}><X size={15}/></button>}{open&&query&&<div className="bank-results" id="bank-results" role="listbox">{rows.map((b,i)=><a key={b.id} role="option" aria-selected={i===active} id={'bank-'+i} href={analysis+b.id} onPointerEnter={()=>setActive(i)}>{b.displayName}<small>{b.perimeter}</small></a>)}{!rows.length&&<p>Nenhuma instituição encontrada.</p>}</div>}</div>
}

function App(){
 const host=useRef(null),map=useRef(null),playRef=useRef(false),timers=useRef([]),initialMobile=useRef(innerWidth<700),selectionRef=useRef([]);
 const [ready,setReady]=useState(false),[fault,setFault]=useState(''),[rasterFault,setRasterFault]=useState(false),[place,setPlace]=useState(1),[playing,setPlaying]=useState(false),[selected,setSelected]=useState([]),[hover,setHover]=useState(null),[visible,setVisible]=useState(0),[zoom,setZoom]=useState(11.8),[query,setQuery]=useState(''),[showResults,setShowResults]=useState(false),[active,setActive]=useState(0),[info,setInfo]=useState(false);
 const reduced=useRef(matchMedia('(prefers-reduced-motion: reduce)').matches);
 const clearTimers=()=>{timers.current.forEach(clearTimeout);timers.current=[];};
 const stop=()=>{clearTimers();playRef.current=false;setPlaying(false);map.current?.stop()};
 const choose=(features)=>{stop();setPlace(null);setSelected(features);setHover(null);setQuery('');setShowResults(false)};
 selectionRef.current=selected;
 const focus=(index,duration=1200)=>{stop();setSelected([]);setPlace(index);const s=STOPS[index];map.current?.flyTo({...s,zoom:index===0&&initialMobile.current?2.65:s.zoom,pitch:0,bearing:0,duration:reduced.current?0:duration,padding:{left:initialMobile.current?0:130,top:initialMobile.current?100:0,bottom:initialMobile.current?70:0,right:0},essential:false})};
 const results=useMemo(()=>{const q=normalize(query.trim());return q?points.features.filter(f=>normalize([f.properties.name,f.properties.city,f.properties.address,f.properties.branchCode].join(' ')).includes(q)).slice(0,6):[]},[query]);
 const goToFeature=f=>{choose(points.features.filter(p=>coordinatesOf(p)===coordinatesOf(f)));map.current?.flyTo({center:f.geometry.coordinates,zoom:15.4,duration:reduced.current?0:1100,padding:{left:initialMobile.current?0:180,bottom:initialMobile.current?210:0,top:0,right:0}})};
 useEffect(()=>{
  let instance;
  try{
   maplibregl.setWorkerUrl(new URL('./dist/maplibre-gl-worker.mjs',location.href).href);
   maplibregl.setMaxParallelImageRequests(4);
   instance=new maplibregl.Map({container:host.current,center:STOPS[1].center,zoom:initialMobile.current?11.1:11.8,maxZoom:17,minZoom:2.3,attributionControl:false,dragRotate:false,pitchWithRotate:false,touchPitch:false,renderWorldCopies:false,canvasContextAttributes:{preserveDrawingBuffer:true},fadeDuration:180,maxTileCacheSize:70,style:{version:8,sources:{streets:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,minzoom:10,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'}},layers:[{id:'paper',type:'background',paint:{'background-color':'#e5eeee'}},{id:'streets',source:'streets',type:'raster',minzoom:10,paint:{'raster-saturation':-1,'raster-opacity':['interpolate',['linear'],['zoom'],10,0,11,.8],'raster-contrast':-.15,'raster-brightness-min':.27,'raster-brightness-max':.99}}]}});
   map.current=instance;
   instance.addControl(new maplibregl.AttributionControl({compact:false}),'bottom-right');
   instance.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
   instance.on('error',e=>{
    if(e.sourceId==='streets'&&!instance.__rasterStopped){instance.__rasterStopped=true;setRasterFault(true);if(instance.getLayer('streets'))instance.removeLayer('streets');if(instance.getSource('streets'))instance.removeSource('streets')}
   });
   instance.on('load',()=>{
    instance.addSource('states',{type:'geojson',data:states});
    instance.addLayer({id:'land',type:'fill',source:'states',maxzoom:10,paint:{'fill-color':'#fafaf5','fill-opacity':['interpolate',['linear'],['zoom'],9,1,10,0]}},instance.getLayer('streets')?'streets':undefined);
    instance.addSource('municipalities',{type:'geojson',data:municipalities,tolerance:.5});
    instance.addLayer({id:'municipal-lines',type:'line',source:'municipalities',maxzoom:10,paint:{'line-color':'#b9cccc','line-width':.5,'line-opacity':['interpolate',['linear'],['zoom'],3,.12,7,.6,10,.05]}});
    instance.addLayer({id:'state-lines',type:'line',source:'states',maxzoom:10,paint:{'line-color':'#7e9fa1','line-width':.7,'line-opacity':['interpolate',['linear'],['zoom'],8,.6,10,0]}});
    instance.addSource('agencies',{type:'geojson',data:points});
    instance.addLayer({id:'point-rings',type:'circle',source:'agencies',minzoom:12,paint:{'circle-radius':['interpolate',['linear'],['zoom'],12,7,16,13],'circle-color':'#c39a16','circle-opacity':.12}});
    instance.addLayer({id:'points',type:'circle',source:'agencies',paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,2,7,3,12,5,16,7],'circle-color':['case',['boolean',['feature-state','selected'],false],'#1b526c','#c39912'],'circle-stroke-color':'#70590d','circle-stroke-width':['interpolate',['linear'],['zoom'],3,.5,12,.8],'circle-opacity':.95}});
    instance.addLayer({id:'hover-ring',type:'circle',source:'agencies',paint:{'circle-radius':11,'circle-color':'#1b526c','circle-opacity':0,'circle-stroke-width':['case',['boolean',['feature-state','hover'],false],2,0],'circle-stroke-color':'#1b526c'}});
    const count=()=>{const bounds=instance.getBounds();setVisible(points.features.filter(f=>bounds.contains(f.geometry.coordinates)).length);setZoom(instance.getZoom())};
    instance.on('moveend',count);count();setReady(true);
    instance.on('click','points',e=>{
     const hit=points.features.find(f=>f.id===e.features[0].id);if(!hit)return;const same=points.features.filter(f=>coordinatesOf(f)===coordinatesOf(hit));choose(same);
     if(initialMobile.current)instance.easeTo({center:hit.geometry.coordinates,padding:{bottom:230},duration:700});
    });
    let last;
    instance.on('mousemove','points',e=>{instance.getCanvas().style.cursor='pointer';const f=e.features[0];if(last!==undefined)instance.setFeatureState({source:'agencies',id:last},{hover:false});last=f.id;instance.setFeatureState({source:'agencies',id:last},{hover:true});setHover({name:pretty(f.properties.name),x:e.point.x,y:e.point.y})});
    instance.on('mouseleave','points',()=>{instance.getCanvas().style.cursor='';if(last!==undefined)instance.setFeatureState({source:'agencies',id:last},{hover:false});setHover(null)});
   });
   instance.on('dragstart',e=>{if(e.originalEvent){stop();setPlace(null)}});
   instance.on('zoomstart',e=>{if(e.originalEvent){stop();setPlace(null)}});
   instance.getCanvas().setAttribute('aria-label','Mapa de agências do Banco do Brasil. Use as setas para mover e os botões para aproximar. A busca oferece os mesmos pontos em uma lista.');
  }catch(e){setFault('O mapa não carregou. A lista de agências continua disponível.');}
  return()=>{clearTimers();instance?.remove()};
 },[]);
 useEffect(()=>{const m=map.current;if(!ready)return;points.features.forEach(f=>m.setFeatureState({source:'agencies',id:f.id},{selected:selected.some(s=>s.id===f.id)}))},[selected,ready]);
 useEffect(()=>{const key=e=>{if(e.key==='Escape'){setSelected([]);setInfo(false);setShowResults(false)}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[]);
 const play=()=>{
  if(playing){stop();return}clearTimers();setSelected([]);setQuery('');setShowResults(false);playRef.current=true;setPlaying(true);setPlace(0);
  const m=map.current;m.stop();m.jumpTo({...STOPS[0],zoom:initialMobile.current?2.65:STOPS[0].zoom,pitch:0,bearing:0,padding:{left:initialMobile.current?0:160,top:0,bottom:0,right:0}});
  timers.current.push(setTimeout(()=>{if(!playRef.current)return;setPlace(1);m.flyTo({...STOPS[1],zoom:11.4,pitch:0,bearing:0,duration:reduced.current?0:10000,curve:1.15,padding:{left:initialMobile.current?0:130,top:initialMobile.current?100:0,bottom:0,right:0},essential:false})},800));
  timers.current.push(setTimeout(()=>{if(!playRef.current)return;setPlace(2);m.easeTo({...STOPS[2],zoom:14.7,pitch:0,bearing:0,duration:reduced.current?0:6000,padding:{left:initialMobile.current?0:180,top:initialMobile.current?100:0,bottom:0,right:0},essential:false})},10850));
  timers.current.push(setTimeout(()=>{playRef.current=false;setPlaying(false)},17000));
 };
 useEffect(()=>{const media=matchMedia('(max-width:699px)');const update=()=>{stop();initialMobile.current=media.matches;map.current?.setPadding({left:media.matches?0:130,right:0,top:media.matches?100:0,bottom:media.matches&&selectionRef.current.length?230:0})};media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
 const selectedTitle=selected.length?cityName(selected[0]):(STOPS[place]?.name||'Área visível');
 return <main className="atlas">
  <div className="map" ref={host}/>
  <header><a className="wordmark" href="https://matheusprat.es/atlas-sfn/">Atlas</a><BankSearch/></header>
  <aside className={'reading '+(selected.length?'has-selection':'')} aria-label="Agências do Banco do Brasil">
   <div className="section-heading"><h1>Agências</h1><span className="bank-label"><i/>Banco do Brasil</span></div>
   <p className="coverage">Amostra · {total} localizações</p>
   <div className="place-search"><Search size={17}/><input value={query} placeholder="Cidade, agência ou endereço" aria-label="Buscar agência na amostra" role="combobox" aria-expanded={showResults&&!!query} aria-controls="place-results" aria-autocomplete="list" aria-activedescendant={showResults&&results[active]?'place-'+active:undefined} onFocus={()=>setShowResults(true)} onChange={e=>{setQuery(e.target.value);setShowResults(true);setActive(0)}} onKeyDown={e=>{if(e.key==='Escape')setShowResults(false);if(e.key==='ArrowDown'){e.preventDefault();setActive(v=>Math.min(results.length-1,v+1))}if(e.key==='ArrowUp'){e.preventDefault();setActive(v=>Math.max(0,v-1))}if(e.key==='Enter'&&results[active])goToFeature(results[active])}}/>{query&&<button aria-label="Limpar busca de agência" onClick={()=>setQuery('')}><X size={15}/></button>}</div>
   {showResults&&query&&<div className="place-results" id="place-results" role="listbox">{results.map((f,i)=><button key={f.id} role="option" aria-selected={active===i} id={'place-'+i} onClick={()=>goToFeature(f)} onPointerEnter={()=>setActive(i)}><span>{branchName(f)}</span><small>{cityName(f)} · {f.properties.uf}<br/>{pretty(f.properties.address)}</small></button>)}{!results.length&&<p>Sem resultado nesta amostra.</p>}</div>}
   {!selected.length&&<div className="location-summary"><span>{selectedTitle}</span><span>{visible} <small>no mapa</small></span></div>}
   {selected.length>0&&<section className="agency-detail"><button className="close-detail" aria-label="Fechar agência" onClick={()=>setSelected([])}><X size={17}/></button>{selected.map(f=><div key={f.id}><h2>{branchName(f)}</h2><p>{pretty(f.properties.address)}</p><p>{cityName(f)} · {f.properties.uf}</p><small>Agência {f.properties.branchCode}</small></div>)}<a href={analysis+'b0cbcee8867e0b37'}>Analisar Banco do Brasil <ArrowUpRight size={14}/></a></section>}
   {!selected.length&&<p className="map-hint">Cada ponto corresponde a uma agência.</p>}
  </aside>
  {hover&&!selected.length&&<div className="map-tooltip" style={{left:Math.min(innerWidth-260,Math.max(20,hover.x+14)),top:Math.max(80,hover.y-45)}}>{hover.name}</div>}
  {(!ready||fault)&&<div className="map-status" role="status">{fault||'Carregando o mapa…'}</div>}
  {rasterFault&&<div className="raster-warning" role="status">Mapa de ruas indisponível. As coordenadas continuam visíveis.</div>}
  <div className="zoom-tools"><button aria-label="Aproximar mapa" disabled={!ready} onClick={()=>{stop();setPlace(null);map.current.zoomIn({duration:350})}}><Plus size={20}/></button><button aria-label="Afastar mapa" disabled={!ready} onClick={()=>{stop();setPlace(null);map.current.zoomOut({duration:350})}}><Minus size={20}/></button></div>
  <footer><div className="journey"><button className="play" aria-label={playing?'Pausar aproximação':'Reproduzir aproximação'} aria-pressed={playing} disabled={!ready} onClick={play}>{playing?<Pause size={17}/>:<Play size={17}/>}</button><nav aria-label="Lugares">{STOPS.map((s,i)=><button key={s.name} aria-current={place===i?'location':undefined} onClick={()=>focus(i)}>{s.name}</button>)}</nav><div className="arrows"><button aria-label="Lugar anterior" disabled={!ready||place===0||place==null} onClick={()=>focus(place-1)}><ArrowLeft size={17}/></button><button aria-label="Próximo lugar" disabled={!ready||place===3||place==null} onClick={()=>focus(place+1)}><ArrowRight size={17}/></button></div></div><div className="source"><span>BCB / Open Finance BB</span><button aria-label="Fontes e cobertura" aria-expanded={info} onClick={()=>setInfo(v=>!v)}><Info size={16}/></button></div></footer>
  {info&&<aside className="source-info" aria-label="Fontes e cobertura"><button className="close-detail" aria-label="Fechar fontes" onClick={()=>setInfo(false)}><X size={18}/></button><h2>Fontes e cobertura</h2><p>{total} agências, de 3.909 cadastradas para o Banco do Brasil no BCB ({(total/3909*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%). Amostra parcial, com falhas de paginação; a distribuição não representa a rede completa.</p><p>Coordenadas publicadas pelo banco e identificadas por código da agência e município no cadastro BCB de 05/11/2026. Foram mantidos os pontos dentro do município declarado, conforme a malha simplificada do IBGE. Essa checagem não confirma a posição exata do endereço.</p><p>Seis pontos próximos ao limite municipal e uma coordenada fora do município foram retirados desta vista. Pontos coincidentes mantêm a mesma posição.</p><p>A aproximação muda apenas a câmera. Todas as agências pertencem à mesma posição cadastral.</p><div className="source-links"><a href="https://dadosabertos.bcb.gov.br/dataset/agencias" target="_blank" rel="noreferrer">Cadastro BCB <ArrowUpRight size={13}/></a><a href="https://opendata.api.bb.com.br/open-banking/channels/v2/branches" target="_blank" rel="noreferrer">Coordenadas BB <ArrowUpRight size={13}/></a><a href="https://servicodados.ibge.gov.br/api/docs/malhas" target="_blank" rel="noreferrer">Malhas IBGE <ArrowUpRight size={13}/></a></div></aside>}
 </main>
}
createRoot(document.getElementById('root')).render(<App/>);
