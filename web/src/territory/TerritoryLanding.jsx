import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../atlas-landing.css';
import './territory.css';
// Cena e cálculos de inadimplência do próprio site: mesma regra de taxa, escala e morfologia.
import AtlasScene, { ATLAS_RATE_SCALE } from '../AtlasScene.jsx';
import { makeCube, rate, percent, monthLabel as siteMonth } from '../atlas-data.js';
import { loadAtlasAsset } from '../atlas-publication.js';
import { BASE, json } from '../data.js';
import { APP_NAVIGATION } from '../AppShell.jsx';
import { baseStyle } from './map-style.js';
import { toView, fromView, interpolateZoom, clamp, smooth, lerp } from './flight.js';

const ANALYSIS = BASE + '?view=institutions&bank=';
// Arquivos do território ficam na publicação estática; não fazem parte das revisões compartilhadas.
const territoryJSON = name => fetch(BASE + 'data/territorio/' + name).then(r => { if (!r.ok) throw Error('Dados do território indisponíveis (' + r.status + ').'); return r.json(); });
const KIND_COLOR = { agencia: '#1f4e63', cooperativa: '#1d8a5c', posto: '#86aab0', ouro: '#a8740f' };
const KIND_LABEL = { agencia: 'Agência', cooperativa: 'Posto de cooperativa', pab: 'Posto de atendimento bancário', paa: 'Posto avançado', cambio: 'Posto de câmbio', ouro: 'Posto de compra de ouro', outro_posto: 'Posto' };
const PRECISION_LABEL = { numero: 'Endereço localizado pelo número', numero_aproximado: 'Endereço localizado por número próximo', logradouro: 'Endereço localizado pela rua', cep: 'Localização aproximada pelo CEP', localidade: 'Localização aproximada pelo bairro', municipio: 'Localização aproximada pelo município' };
const LAYERS = ['pts-inst', 'pts-gold', 'pts-exact', 'pts-loose'];
// Limites da malha de UFs usada pela cena do site; o mapa vetorial repete o mesmo enquadramento.
const BR_BOUNDS = [[-73.9856, -33.7439], [-34.7932, 5.2673]];
const PAD = { top: 24, bottom: 24, left: 22, right: 22 };

const nf = (v, d = 0) => v == null || Number.isNaN(v) ? 'N/D' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = v => v == null ? 'N/D' : Math.abs(v) >= 1e9 ? 'R$ ' + nf(v / 1e9, 1) + ' bi' : Math.abs(v) >= 1e6 ? 'R$ ' + nf(v / 1e6, 0) + ' mi' : 'R$ ' + nf(v / 1e3, 0) + ' mil';
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pretty = s => String(s || '').toLocaleLowerCase('pt-BR').replace(/(^|[\s/(-])\p{L}/gu, c => c.toLocaleUpperCase('pt-BR')).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, w => w.toLowerCase());
const kindGroup = k => k === 'agencia' ? 'agencia' : k === 'cooperativa' ? 'cooperativa' : k === 'ouro' ? 'ouro' : 'posto';
const compactSegment = (text, kind) => kind === 'size' ? text : text === 'Sem rendimento' ? 'Sem renda' : text === 'Indisponível' ? 'N/D' : text.replace(/^Mais de /, '').replace(/ salários? mínimos?/, '').replace(/ a /, '–').replace('Acima de 20', '20+');

// Passos: 0 inadimplência no mapa, 1 distribuição por renda, 2 agências e postos, 3 ouro em Peixoto de Azevedo.
const LOOK = [
  { scene: 1, choro: 1, base: 0, gold: 0 },
  { scene: 1, choro: 1, base: 0, gold: 0 },
  { scene: 0, choro: 0.35, base: 1, gold: 0 },
  { scene: 0, choro: 0, base: 0.55, gold: 1 },
];
const EXPLORE_LOOK = { scene: 0, choro: 0, base: 1, gold: 0 };
const mix = (a, b, t) => Object.fromEntries(Object.keys(a).map(k => [k, lerp(a[k], b[k], t)]));

function useLoad(load, onError) {
  const [v, setV] = useState(null);
  useEffect(() => { let live = true; load().then(d => live && setV(d)).catch(e => live && onError(e.message)); return () => { live = false; }; }, []);
  return v;
}

export default function TerritoryLanding({ catalog, onNavigate, onOpenInstitution }) {
  const [failure, setFailure] = useState('');
  const meta = useLoad(() => territoryJSON('meta.json'), setFailure), pointData = useLoad(() => territoryJSON('points.json'), setFailure), places = useLoad(() => territoryJSON('places.json'), setFailure);
  const states = useLoad(() => json('data/bank-network-ufs.geojson'), setFailure), municipalities = useLoad(() => territoryJSON('municipalities.json'), setFailure);
  const pf = useLoad(() => loadAtlasAsset('atlas-pf.json').then(r => r.source), setFailure), pj = useLoad(() => loadAtlasAsset('atlas-pj.json').then(r => r.source), setFailure);
  const [details, setDetails] = useState(null), [menu, setMenu] = useState(false);
  const detailsRequested = useRef(false);
  const loadDetails = useCallback(() => { if (detailsRequested.current) return; detailsRequested.current = true; territoryJSON('details.json').then(setDetails).catch(() => { detailsRequested.current = false; }); }, []);
  const openAnalysis = (event, id) => {
    const bank = catalog?.institutions.find(b => b.id === id);
    if (!bank || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpenInstitution(bank);
  };
  const go = (event, page) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setMenu(false); onNavigate(page); };

  const host = useRef(null), column = useRef(null), stepRefs = useRef([]), exploreRef = useRef(null), sceneLayer = useRef(null), veil = useRef(null);
  const map = useRef(null), modeRef = useRef('story'), frame = useRef(0), blend = useRef(null), anim = useRef(null), anchors = useRef([]), stops = useRef([]);
  const [ready, setReady] = useState(false), [mode, setMode] = useState('story'), [step, setStep] = useState(0), [view, setView] = useState(null);
  const [selected, setSelected] = useState(null), [inst, setInst] = useState(null);
  const [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false), [active, setActive] = useState(0);
  const [person, setPerson] = useState('PF'), [segments, setSegments] = useState({ PF: -1, PJ: -1 }), [uf, setUf] = useState(null);
  const [monthKey, setMonthKey] = useState(null), [playing, setPlaying] = useState(false), [motion, setMotion] = useState(false), [info, setInfo] = useState(false);
  const instRef = useRef(null), lastLook = useRef(null), chapterRef = useRef(0);
  instRef.current = inst;

  const rows = pointData?.rows, kinds = meta?.kinds;
  const placeByCode = useMemo(() => new Map((places || []).map(p => [p.ibge, p])), [places]);
  const cubes = useMemo(() => pf && pj ? { PF: makeCube(pf), PJ: makeCube(pj) } : null, [pf, pj]);
  const cube = cubes?.[person], ds = cube?.dims, segment = segments[person];
  const month = ds ? Math.max(0, monthKey === null ? ds.months.length - 1 : ds.months.findLastIndex(m => m <= monthKey)) : 0;
  const series = useMemo(() => cube ? ds.months.map((_, m) => ds.ufs.map((__, s) => rate(cube.get(m, segment, -1, s)))) : [], [cube, segment]);
  const ufIndex = code => ds ? ds.ufs.findIndex(s => s.uf === code) : -1;

  // Coroplético do mapa vetorial: mesmos valores da cena do site, no mês e recorte correntes.
  useEffect(() => {
    const m = map.current; if (!ready || !ds) return;
    ds.ufs.forEach((s, i) => m.setFeatureState({ source: 'states', id: s.uf }, { rate: series[month]?.[i] ?? null }));
  }, [ready, ds, series, month]);

  useEffect(() => {
    if (!meta || !rows || !states || !municipalities || !places || !cubes || !host.current || map.current) return;
    const kindIdx = k => meta.kinds.indexOf(k);
    const features = rows.map(r => ({ type: 'Feature', id: r[7], geometry: { type: 'Point', coordinates: [r[0], r[1]] }, properties: { k: r[2], g: kindGroup(meta.kinds[r[2]]), i: r[3], p: r[4] } }));
    let m;
    try {
      maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href);
      m = new maplibregl.Map({ container: host.current, style: baseStyle(states, municipalities), bounds: BR_BOUNDS, fitBoundsOptions: { padding: PAD }, minZoom: 2.4, maxZoom: 18, dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false, attributionControl: false, fadeDuration: 0 });
    } catch (e) { setFailure('O mapa não pôde ser aberto neste navegador.'); return; }
    map.current = m;
    m.on('load', () => {
      m.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      const color = ['match', ['get', 'g'], 'agencia', KIND_COLOR.agencia, 'cooperativa', KIND_COLOR.cooperativa, 'ouro', KIND_COLOR.ouro, KIND_COLOR.posto];
      const radius = ['interpolate', ['linear'], ['zoom'], 3, 1.15, 6, 1.9, 9, 3, 12, 4.6, 16, 7];
      m.addLayer({ id: 'pts-loose', type: 'circle', source: 'pts', filter: ['>=', ['get', 'p'], 3], paint: { 'circle-color': color, 'circle-radius': radius, 'circle-opacity': 0 } });
      m.addLayer({ id: 'pts-exact', type: 'circle', source: 'pts', filter: ['<', ['get', 'p'], 3], paint: { 'circle-color': color, 'circle-radius': radius, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 11, 1], 'circle-opacity': 0, 'circle-stroke-opacity': 0 } });
      m.addLayer({ id: 'pts-gold', type: 'circle', source: 'pts', filter: ['==', ['get', 'k'], kindIdx('ouro')], paint: { 'circle-color': KIND_COLOR.ouro, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.4, 10, 6, 15, 9], 'circle-stroke-color': '#3d2a05', 'circle-stroke-width': 1.1, 'circle-opacity': 0, 'circle-stroke-opacity': 0 } });
      m.addLayer({ id: 'pts-inst', type: 'circle', source: 'pts', filter: ['==', ['get', 'i'], -1], paint: { 'circle-color': KIND_COLOR.agencia, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 8, 3.4, 12, 6, 16, 8.5], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0.3, 10, 1.2] } });
      m.addLayer({ id: 'pts-selected', type: 'circle', source: 'pts', filter: ['==', ['id'], -1], paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 14, 13], 'circle-stroke-color': '#0f2633', 'circle-stroke-width': 2.2 } });
      for (const id of LAYERS) { m.on('mouseenter', id, () => { if (chapterRef.current >= 2) m.getCanvas().style.cursor = 'pointer'; }); m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; }); }
      m.on('click', e => {
        if (chapterRef.current < 2) return;
        const hit = m.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: LAYERS });
        if (hit.length) choosePoint(hit[0].id, false);
      });
      setReady(true);
    });
    m.on('moveend', () => updateView());
    m.on('idle', () => updateView());
    m.on('dragstart', e => { if (e.originalEvent) takeControl(); });
    m.on('zoomstart', e => { if (e.originalEvent) takeControl(); });
    m.getCanvasContainer().addEventListener('wheel', () => takeControl(), { passive: true });
    return () => { cancelAnimationFrame(frame.current); m.remove(); map.current = null; };
  }, [meta, rows, states, municipalities, places, cubes]);

  // Câmeras das paradas no tamanho real do mapa. As três primeiras repetem o enquadramento da cena do site.
  const computeStops = useCallback(() => {
    const m = map.current; if (!m || !meta) return;
    const c = m.cameraForBounds(BR_BOUNDS, { padding: PAD });
    const brasil = { center: [c.center.lng, c.center.lat], zoom: c.zoom };
    const w = m.getCanvas().clientWidth, h = m.getCanvas().clientHeight, span = Math.min(w, h * 1.25);
    const gold = { center: meta.story.goldCenter || [-54.99, -10.24], zoom: 10.9 + Math.log2(span / 1000) };
    stops.current = [brasil, brasil, brasil, gold];
  }, [meta]);

  function applyLook(L) {
    const m = map.current; if (!m?.getLayer('pts-exact')) return;
    const base = instRef.current != null ? 0.12 : L.base;
    const key = [L.scene, L.choro, base, L.gold].map(v => v.toFixed(3)).join();
    if (key === lastLook.current) return; lastLook.current = key;
    if (sceneLayer.current) { sceneLayer.current.style.opacity = L.scene; sceneLayer.current.style.visibility = L.scene > 0.01 ? 'visible' : 'hidden'; sceneLayer.current.style.pointerEvents = L.scene > 0.5 ? 'auto' : 'none'; }
    if (veil.current) veil.current.style.opacity = L.scene;
    m.setPaintProperty('uf-fill', 'fill-opacity', L.choro);
    m.setPaintProperty('state-line', 'line-color', L.choro > 0.6 ? '#f5f6f2' : '#9fb4b6');
    m.setPaintProperty('pts-exact', 'circle-opacity', base);
    m.setPaintProperty('pts-exact', 'circle-stroke-opacity', base);
    m.setPaintProperty('pts-loose', 'circle-opacity', ['interpolate', ['linear'], ['zoom'], 10.5, base, 12.5, base * 0.18]);
    m.setPaintProperty('pts-gold', 'circle-opacity', Math.max(L.gold, base > 0.5 ? 1 : 0) * (1 - L.scene));
    m.setPaintProperty('pts-gold', 'circle-stroke-opacity', L.gold);
  }

  const measure = useCallback(() => {
    const col = column.current; if (!col) return;
    const head = col.querySelector('.column-head')?.offsetHeight || 0;
    anchors.current = stepRefs.current.filter(Boolean).map((el, i) => i === 0 ? 0 : Math.max(0, el.offsetTop - head - 24));
    anchors.current.push(exploreRef.current ? Math.max(0, exploreRef.current.offsetTop - head) : Infinity);
  }, []);

  function storyState(scroll) {
    const a = anchors.current, n = LOOK.length;
    for (let i = 0; i < n - 1; i++) if (scroll < a[i + 1]) return { i, t: clamp((scroll - a[i]) / (a[i + 1] - a[i])) };
    return { i: n - 1, t: 0 };
  }

  function render() {
    frame.current = 0;
    const m = map.current, col = column.current; if (!m || !col || modeRef.current !== 'story' || !stops.current.length) return;
    const { i, t } = storyState(col.scrollTop);
    const u = smooth(clamp((t - 0.2) / 0.6));
    const width = m.getCanvas().clientWidth || 800;
    const A = stops.current[i], B = stops.current[Math.min(i + 1, LOOK.length - 1)];
    let target = fromView(interpolateZoom(toView(A, width), toView(B, width))(u), width);
    if (blend.current) {
      const k = clamp((performance.now() - blend.current.start) / 650);
      target = fromView(interpolateZoom(toView(blend.current.from, width), toView(target, width))(smooth(k)), width);
      if (k >= 1) blend.current = null; else frame.current = requestAnimationFrame(render);
    }
    m.jumpTo(target);
    applyLook(mix(LOOK[i], LOOK[Math.min(i + 1, LOOK.length - 1)], u));
    const current = u > 0.5 ? Math.min(i + 1, LOOK.length - 1) : i;
    if (current !== chapterRef.current) { chapterRef.current = current; setStep(current); }
  }

  function onScroll() {
    const col = column.current; if (!col) return;
    const exploreAt = Math.min(anchors.current[anchors.current.length - 1], col.scrollHeight - col.clientHeight);
    const next = col.scrollTop >= exploreAt - 2 ? 'explore' : 'story';
    if (next !== modeRef.current) {
      if (next === 'story' && map.current) blend.current = { from: { center: map.current.getCenter().toArray(), zoom: map.current.getZoom() }, start: performance.now() };
      modeRef.current = next; setMode(next);
      if (next === 'explore') enterExplore();
    }
    if (next === 'story' && !frame.current) frame.current = requestAnimationFrame(render);
  }
  function enterExplore() { chapterRef.current = 9; setStep(9); setPlaying(false); lastLook.current = null; applyLook(EXPLORE_LOOK); }

  function takeControl() {
    cancelAnim();
    if (modeRef.current === 'explore') return;
    modeRef.current = 'explore'; setMode('explore'); enterExplore();
    const col = column.current, exploreAt = anchors.current[anchors.current.length - 1];
    if (col && Number.isFinite(exploreAt)) col.scrollTop = exploreAt;
  }
  function cancelAnim() { if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; } }
  function flyTo(camera) {
    const m = map.current; if (!m) return; takeControl(); cancelAnim();
    const width = m.getCanvas().clientWidth || 800;
    const f = interpolateZoom(toView({ center: m.getCenter().toArray(), zoom: m.getZoom() }, width), toView(camera, width));
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : clamp(f.duration * 650, 700, 2600), start = performance.now();
    const tick = () => { const k = ms ? clamp((performance.now() - start) / ms) : 1; m.jumpTo(fromView(f(smooth(k)), width)); anim.current = k < 1 ? requestAnimationFrame(tick) : null; };
    tick();
  }

  useEffect(() => {
    if (!ready) return;
    computeStops(); measure(); lastLook.current = null; onScroll(); if (modeRef.current === 'story') render();
    const ro = new ResizeObserver(() => { computeStops(); measure(); onScroll(); });
    ro.observe(column.current); ro.observe(host.current);
    return () => ro.disconnect();
  }, [ready, measure, computeStops]);

  const updateTimer = useRef(0);
  function updateView() {
    clearTimeout(updateTimer.current);
    updateTimer.current = setTimeout(() => {
      const m = map.current; if (!m || !rows || modeRef.current !== 'explore') return;
      const b = m.getBounds(), z = m.getZoom(), c = m.project(m.getCenter());
      const W = b.getWest(), E = b.getEast(), S = b.getSouth(), N = b.getNorth();
      const counts = { agencia: 0, postos: 0 }, byInst = new Map();
      for (const r of rows) {
        if (r[0] < W || r[0] > E || r[1] < S || r[1] > N) continue;
        if (kinds[r[2]] === 'agencia') counts.agencia++; else counts.postos++;
        byInst.set(r[3], (byInst.get(r[3]) || 0) + 1);
      }
      const muni = z >= 7 ? m.queryRenderedFeatures(c, { layers: ['muni-hit'] })[0]?.properties?.codarea : null;
      const st = z >= 4.6 ? m.queryRenderedFeatures(c, { layers: ['state-hit'] })[0]?.properties : null;
      setView({ counts, topInst: [...byInst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), muni: muni ? String(muni) : null, uf: st?.uf || null });
    }, 120);
  }
  useEffect(() => { if (mode === 'explore') updateView(); }, [mode]);

  function choosePoint(idx, fly = true) {
    loadDetails(); setSelected(idx);
    const m = map.current, r = rows[idx];
    m?.setFilter('pts-selected', ['==', ['id'], idx]);
    if (fly) flyTo({ center: [r[0], r[1]], zoom: Math.max(15, m.getZoom()) }); else takeControl();
  }
  function clearPoint() { setSelected(null); map.current?.setFilter('pts-selected', ['==', ['id'], -1]); }
  function chooseInst(i) {
    setInst(i); instRef.current = i;
    const m = map.current, x = meta.institutions[i]; if (!m) return;
    m.setFilter('pts-inst', ['==', ['get', 'i'], i]);
    m.setPaintProperty('pts-inst', 'circle-color', x.color || (x.segment === 'Cooperativa de Crédito' ? KIND_COLOR.cooperativa : KIND_COLOR.agencia));
    lastLook.current = null; applyLook(EXPLORE_LOOK);
  }
  function clearInst() { setInst(null); instRef.current = null; map.current?.setFilter('pts-inst', ['==', ['get', 'i'], -1]); lastLook.current = null; applyLook(EXPLORE_LOOK); }
  useEffect(() => { const k = e => { if (e.key === 'Escape') { clearPoint(); setSearchOpen(false); setInfo(false); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);

  const results = useMemo(() => {
    const q = norm(query); if (!q || !meta || !places) return [];
    const toks = q.split(' '), out = [];
    places.filter(p => toks.every(t => norm(p.name + ' ' + p.uf).includes(t))).sort((a, b) => (b.agencias + b.postos) - (a.agencias + a.postos)).slice(0, 4)
      .forEach(p => out.push({ type: 'place', key: 'p' + p.ibge, label: p.name, sub: p.uf, p }));
    meta.institutions.map((x, i) => ({ x, i })).filter(({ x }) => toks.every(t => norm(x.name + ' ' + x.legalName).includes(t))).sort((a, b) => b.x.count - a.x.count).slice(0, 4)
      .forEach(({ x, i }) => out.push({ type: 'inst', key: 'i' + i, label: x.name, sub: nf(x.count) + ' unidades', i }));
    if (details && q.length >= 3) {
      let n = 0;
      for (let j = 0; j < details.length && n < 4; j++) {
        const d = details[j];
        if (toks.every(t => norm(d.unit + ' ' + d.address + ' ' + d.bairro + ' ' + (placeByCode.get(d.ibge)?.name || '')).includes(t))) {
          out.push({ type: 'unit', key: 'u' + j, label: pretty(d.unit || d.address), sub: meta.institutions[rows[j][3]].name + ' · ' + (placeByCode.get(d.ibge)?.name || ''), j }); n++;
        }
      }
    }
    const rank = r => norm(r.label) === q ? (r.type === 'inst' && meta.institutions[r.i].count >= 50 ? 0 : 1) : 2;
    return out.map((r, k) => [r, k]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
  }, [query, meta, places, details, placeByCode, rows]);
  function pick(r) {
    setSearchOpen(false); setQuery('');
    if (r.type === 'place') { clearPoint(); flyTo({ center: r.p.visit || [r.p.lon, r.p.lat], zoom: r.p.agencias + r.p.postos > 60 ? 11.5 : r.p.visit ? 13.5 : 11 }); }
    if (r.type === 'inst') { takeControl(); chooseInst(r.i); }
    if (r.type === 'unit') choosePoint(r.j, true);
  }

  if (!meta || !rows || !places || !cubes || !states) return <main className="territory loading"><p role={failure ? 'alert' : 'status'}>{failure || 'Carregando…'}</p>{failure && <button onClick={() => location.reload()}>Recarregar</button>}</main>;
  const c = meta.counts, instInfo = inst != null ? meta.institutions[inst] : null;
  const selIdx = ufIndex(uf);
  const scope = segment < 0 ? (person === 'PF' ? 'Todas as rendas' : 'Todos os portes') : ds.segments[segment];
  const reading = rate(cube.get(month, segment, -1, selIdx)), national = rate(cube.get(month, segment, -1));
  const viewIdx = mode === 'explore' ? ufIndex(view?.uf) : -1;
  const latest = ds.months.length - 1;
  const muni = view?.muni ? placeByCode.get(view.muni) : null;
  const sel = selected != null ? rows[selected] : null, selD = selected != null && details ? details[selected] : null, selInst = sel ? meta.institutions[sel[3]] : null;
  const highlights = step === 1 && selIdx < 0 ? ['AM', 'SP'].map((s, i) => ({ index: ufIndex(s), color: i ? '#ec7000' : '#315f78' })) : [];
  const gold = c.goldByMunicipality[0];
  const sourceLine = step <= 1 ? 'BCB / SCR.data' : 'BCB / cadastro de agências e postos · IBGE / CNEFE 2022 · © OpenStreetMap';
  const setSegment = i => { setSegments(s => ({ ...s, [person]: i })); setMotion(true); };
  const segmentControl = <div className="atlas-segment-control">
    <label>{person === 'PF' ? 'Renda mensal' : 'Porte da empresa'}<span>{person === 'PF' ? 'salários mínimos' : ''}</span></label>
    <input aria-label={person === 'PF' ? 'Faixa de renda' : 'Porte da empresa'} type="range" min={-1} max={ds.segments.length - 1} step={1} value={segment} aria-valuetext={scope} onChange={e => setSegment(+e.target.value)} />
    <div className="atlas-segment-ticks">{[-1, ...ds.segments.keys()].map(i => <button key={i} aria-pressed={segment === i} aria-label={i < 0 ? 'Todas' : ds.segments[i]} onClick={() => setSegment(i)}>{i < 0 ? 'Todas' : compactSegment(ds.segments[i], ds.segmentKind)}</button>)}</div>
  </div>;
  const personSwitch = <div className="atlas-person-switch" role="group" aria-label="Tipo de cliente"><button aria-pressed={person === 'PF'} onClick={() => setPerson('PF')}>Pessoas físicas</button><button aria-pressed={person === 'PJ'} onClick={() => setPerson('PJ')}>Pessoas jurídicas</button></div>;

  return <main className={'territory atlas-landing mode-' + mode}>
    <header className="atlas-site-header">
      <a className="atlas-wordmark" href={BASE} onClick={e => go(e, 'overview')}>Atlas <span>SFN</span></a>
      <button className="atlas-menu" aria-label="Menu" aria-expanded={menu} aria-controls="territory-nav" onClick={() => setMenu(v => !v)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" /></svg></button>
      <nav id="territory-nav" className={menu ? 'is-open' : ''} aria-label="Navegação principal">{APP_NAVIGATION.map(([k, l]) => <a key={k} href={BASE + '?view=' + k} onClick={e => go(e, k)}>{l}</a>)}</nav>
    </header>
    <div className="body">
      <aside className="column" ref={column} onScroll={onScroll}>
        <div className="column-head">
          <div className="search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
            <input value={query} placeholder="Município, instituição ou endereço" aria-label="Buscar município, instituição ou endereço" role="combobox" aria-expanded={searchOpen && results.length > 0} aria-controls="search-results"
              onFocus={() => { setSearchOpen(true); loadDetails(); }} onChange={e => { setQuery(e.target.value); setActive(0); setSearchOpen(true); }}
              onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); } if (e.key === 'Enter' && results[active]) pick(results[active]); if (e.key === 'Escape') setSearchOpen(false); }} />
            {searchOpen && query && <div className="results" id="search-results" role="listbox">
              {results.map((r, i) => <button key={r.key} role="option" aria-selected={i === active} onPointerEnter={() => setActive(i)} onClick={() => pick(r)}><span>{r.label}</span><small>{r.sub}</small></button>)}
              {!results.length && <p>Nada encontrado{details ? '' : '…'}</p>}
            </div>}
          </div>
        </div>

        <section className="story">
          <article className="step" ref={el => stepRefs.current[0] = el}>
            {personSwitch}
            <div className="atlas-product"><h1>Inadimplência</h1></div>
            <div className="atlas-location"><span>{selIdx < 0 ? 'Brasil' : ds.ufs[selIdx].name}</span>{selIdx >= 0 && <button aria-label="Voltar ao Brasil" onClick={() => setUf(null)}>×</button>}</div>
            <div className="atlas-reading"><strong>{percent(reading)}</strong><span>{siteMonth(ds.months[month])}</span>{selIdx >= 0 && <small>Brasil: {percent(national)}</small>}</div>
            <div className="time">
              <button className="atlas-play" aria-label={playing ? 'Pausar' : 'Reproduzir desde ' + siteMonth(ds.months[0])} onClick={() => { setMotion(true); setPlaying(p => !p); }}>{playing ? <svg viewBox="0 0 20 20"><path d="M7 5v10M13 5v10" /></svg> : <svg viewBox="0 0 20 20"><path d="M7 5l8 5-8 5z" /></svg>}</button>
              <div className="atlas-rate-legend" aria-label="Escala de inadimplência">{ATLAS_RATE_SCALE.map((item, i) => <span key={item.min}><i style={{ background: item.color }} />{item.min}{i === 5 ? '%+' : ''}</span>)}</div>
            </div>
          </article>
          <article className="step" ref={el => stepRefs.current[1] = el}>
            <h2>{person === 'PF' ? 'Por renda' : 'Por porte'}</h2>
            <div className="atlas-reading small"><strong>{percent(reading)}</strong><span>{scope}{selIdx >= 0 ? ' · ' + ds.ufs[selIdx].name : ''}</span></div>
            {segmentControl}
          </article>
          <article className="step" ref={el => stepRefs.current[2] = el}>
            <h2>Agências e postos</h2>
            <p><b>{nf(c.kinds.agencia)}</b> agências de bancos e <b>{nf(c.units - c.kinds.agencia)}</b> postos de atendimento, no endereço cadastrado no Banco Central.</p>
            <p className="legend"><span><i style={{ background: KIND_COLOR.agencia }} />agências</span><span><i style={{ background: KIND_COLOR.cooperativa }} />cooperativas</span><span><i style={{ background: KIND_COLOR.posto }} />outros postos</span></p>
          </article>
          <article className="step" ref={el => stepRefs.current[3] = el}>
            <h2>Ouro em {gold ? gold[0] : 'Mato Grosso'}</h2>
            <p><b>{nf(gold?.[2])}</b> dos {nf(c.kinds.ouro)} postos de compra de ouro do país ficam aqui.</p>
          </article>
        </section>

        <section className="explore" ref={exploreRef}>
          {sel && <div className="unit">
            <button className="close" aria-label="Fechar" onClick={clearPoint}>×</button>
            <p className="kicker"><i style={{ background: selInst.color || KIND_COLOR[kindGroup(kinds[sel[2]])] }} />{KIND_LABEL[kinds[sel[2]]]} · {selInst.name}</p>
            <h2>{selD ? pretty(selD.unit || selD.address) : '…'}</h2>
            {selD && <p className="address">{pretty(selD.address)}{selD.bairro ? ', ' + pretty(selD.bairro) : ''}<br />{placeByCode.get(selD.ibge)?.name} ({placeByCode.get(selD.ibge)?.uf})</p>}
            {selD?.estban && <dl className="balances"><div><dt>Crédito na agência</dt><dd>{money(selD.estban.credito)}</dd></div><div><dt>Poupança</dt><dd>{money(selD.estban.poupanca)}</dd></div></dl>}
            {sel[4] >= 3 && <p className="note">{PRECISION_LABEL[meta.precision[sel[4]]]}.</p>}
            {selInst.analysisId && <a className="analyze" href={ANALYSIS + selInst.analysisId} onClick={e => openAnalysis(e, selInst.analysisId)}>Analisar {selInst.name}</a>}
          </div>}
          <div className="place"><h2>{muni ? muni.name : viewIdx >= 0 ? ds.ufs[viewIdx].name : 'Brasil'}</h2>{muni && <span>{muni.uf}</span>}</div>
          {view && <p className="counts">{nf(view.counts.agencia)} agências · {nf(view.counts.postos)} postos</p>}
          {instInfo && <div className="inst-chip"><i style={{ background: instInfo.color || KIND_COLOR.agencia }} /><span>{instInfo.name}</span><button aria-label="Todas as instituições" onClick={clearInst}>×</button>{instInfo.analysisId && <a className="analyze" href={ANALYSIS + instInfo.analysisId} onClick={e => openAnalysis(e, instInfo.analysisId)}>Analisar</a>}</div>}
          {view?.topInst.length > 0 && !instInfo && <ol className="insts">{view.topInst.map(([i, n]) => { const x = meta.institutions[i]; return <li key={i}><button onClick={() => chooseInst(i)}>
            <span className="bar" style={{ width: (100 * n / view.topInst[0][1]) + '%', background: x.color || (x.segment === 'Cooperativa de Crédito' ? KIND_COLOR.cooperativa : KIND_COLOR.agencia) }} /><span className="name">{x.name}</span><span className="n">{nf(n)}</span></button></li>; })}</ol>}
          <div className="credit-block">
            <h3>Inadimplência{viewIdx >= 0 ? ' em ' + ds.ufs[viewIdx].name : ' no Brasil'}</h3>
            {personSwitch}
            <div className="atlas-reading small"><strong>{percent(rate(cube.get(latest, segment, -1, viewIdx)))}</strong><span>{scope} · {siteMonth(ds.months[latest])}</span>{viewIdx >= 0 && <small>Brasil: {percent(rate(cube.get(latest, segment, -1)))}</small>}</div>
            {segmentControl}
          </div>
        </section>
      </aside>

      <div className="stage">
        <div className="map" ref={host} />
        <div className="veil" ref={veil} />
        <div className="scene-layer" ref={sceneLayer}>
          <AtlasScene geo={states} states={ds.ufs} series={series} month={month} layout={step === 1 ? 'distribution' : 'map'} selected={selIdx} highlights={highlights}
            playing={playing && step <= 1 && mode === 'story'} onSelect={i => setUf(i < 0 ? null : ds.ufs[i].uf)} onMonthChange={i => setMonthKey(ds.months[i])} onPlayingChange={setPlaying} motionRequested={motion} />
        </div>
        {mode === 'explore' && <div className="atlas-scene-camera map-zoom"><button aria-label="Aproximar" onClick={() => map.current?.zoomIn({ duration: 300 })}><svg viewBox="0 0 20 20"><path d="M4 10h12M10 4v12" /></svg></button><button aria-label="Afastar" onClick={() => map.current?.zoomOut({ duration: 300 })}><svg viewBox="0 0 20 20"><path d="M4 10h12" /></svg></button></div>}
        <div className="atlas-source"><span>{sourceLine}</span><button aria-label="Sobre os dados" aria-expanded={info} onClick={() => setInfo(v => !v)}><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5M10 6.2v.1" /></svg></button></div>
        {info && <aside className="atlas-data-info"><button aria-label="Fechar" onClick={() => setInfo(false)}>×</button>
          <p>Inadimplência: saldo com parcela vencida há mais de 90 dias / carteira ativa (SCR.data). UF de residência do tomador PF ou informada para o PJ; não há recorte municipal público.</p>
          <p>Agências e postos: cadastro BCB de 05/11/2026, geocodificado pelo CNEFE 2022 (geocodebr/Ipea). {nf(100 * ((c.precision.numero || 0) + (c.precision.numero_aproximado || 0) + (c.precision.logradouro || 0)) / c.located, 0)}% localizados pelo número ou pela rua; os demais, por CEP, bairro ou município, quase somem na escala de rua. Saldos por agência: ESTBAN jun/2026, onde a operação é contabilizada.</p>
          <p>Mapa de base <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> · malhas IBGE.</p>
        </aside>}
      </div>
    </div>
  </main>;
}
