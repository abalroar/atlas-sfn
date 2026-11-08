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
import Wordmark from '../Wordmark.jsx';
import { baseStyle, PIX_STOPS } from './map-style.js';
import { toView, fromView, interpolateZoom, clamp, smooth, lerp } from './flight.js';

const ANALYSIS = BASE + '?view=institutions&bank=';
// Arquivos do território ficam na publicação estática; não fazem parte das revisões compartilhadas.
const territoryJSON = name => fetch(BASE + 'data/territorio/' + name).then(r => { if (!r.ok) throw Error('Dados do território indisponíveis (' + r.status + ').'); return r.json(); });
const KIND_COLOR = { agencia: '#1f4e63', cooperativa: '#1d8a5c', posto: '#86aab0', ouro: '#a8740f' };
const KIND_LABEL = { agencia: 'Agência', cooperativa: 'Posto de cooperativa', pab: 'Posto de atendimento bancário', paa: 'Posto avançado', cambio: 'Posto de câmbio', ouro: 'Posto de compra de ouro', outro_posto: 'Posto' };
const PRECISION_LABEL = { numero: 'Endereço localizado pelo número', numero_aproximado: 'Endereço localizado por número próximo', logradouro: 'Endereço localizado pela rua', cep: 'Localização aproximada pelo CEP', localidade: 'Localização aproximada pelo bairro', municipio: 'Localização aproximada pelo município' };
const REGIONS = [['Sudeste', 'Sudeste'], ['Sul', 'Sul'], ['Nordeste', 'Nordeste'], ['Centro-oeste', 'Centro-Oeste'], ['Norte', 'Norte'], ['Total Exterior', 'exterior']];
// Ordem em que as redes acendem no filme: os cinco maiores bancos, depois cooperativas e as demais instituições.
const NETWORK_ORDER = ['00000000', '00360305', '60746948', '60701190', '90400888'];
// Cores próprias dos bancos, mais saturadas sobre o relevo: BB amarelo-ouro, Caixa azul, Bradesco vermelho, Itaú laranja, Santander vermelho-escuro.
const BRAND = { '00000000': '#d4a90f', '00360305': '#0a7fb0', '60746948': '#d6283f', '60701190': '#f07014', '90400888': '#8f1d2c' };
const LAYERS = ['pts-inst', 'pts-exact', 'pts-loose'];
// Limites da malha de UFs usada pela cena do site; o mapa vetorial repete o mesmo enquadramento.
const BR_BOUNDS = [[-73.9856, -33.7439], [-34.7932, 5.2673]];
const PAD = { top: 24, bottom: 24, left: 22, right: 22 };
const FILM_PAD = { top: 40, bottom: 150, left: 40, right: 40 };

const nf = (v, d = 0) => v == null || Number.isNaN(v) ? 'N/D' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = v => v == null ? 'N/D' : Math.abs(v) >= 1e9 ? 'R$ ' + nf(v / 1e9, 1) + ' bi' : Math.abs(v) >= 1e6 ? 'R$ ' + nf(v / 1e6, 0) + ' mi' : 'R$ ' + nf(v / 1e3, 0) + ' mil';
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pretty = s => String(s || '').toLocaleLowerCase('pt-BR').replace(/(^|[\s/(-])\p{L}/gu, c => c.toLocaleUpperCase('pt-BR')).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, w => w.toLowerCase());
const kindGroup = k => k === 'agencia' ? 'agencia' : k === 'cooperativa' ? 'cooperativa' : k === 'ouro' ? 'ouro' : 'posto';
const compactSegment = (text, kind) => kind === 'size' ? text : text === 'Sem rendimento' ? 'Sem renda' : text === 'Indisponível' ? 'N/D' : text.replace(/^Mais de /, '').replace(/ salários? mínimos?/, '').replace(/ a /, '–').replace('Acima de 20', '20+');
const ym = v => siteMonth(String(v).replace(/(\d{4})(\d{2})/, '$1-$2'));

// Capítulos. Um relógio único move câmera e dados; ao fim, o mapa abre espaço para a coluna de busca.
const CHAPTERS = [
  { id: 'abertura', label: 'Brasil', ms: 6000 },
  { id: 'rede', label: 'Agências e postos', ms: 13000 },
  { id: 'inad', label: 'Inadimplência', ms: 8000 },
  { id: 'renda', label: 'Por renda', ms: 11000 },
  { id: 'pix', label: 'Pix', ms: 12000 },
  { id: 'fronteira', label: 'Pacaraima', ms: 6500 },
  { id: 'poupanca', label: 'Poupança', ms: 12000 },
  { id: 'rural', label: 'Crédito rural', ms: 12000 },
];
const STARTS = CHAPTERS.reduce((a, c, i) => (a.push(i ? a[i - 1] + CHAPTERS[i - 1].ms : 0), a), []);
const TOTAL = STARTS.at(-1) + CHAPTERS.at(-1).ms;
const chapterAt = t => { const i = Math.max(0, STARTS.findLastIndex(s => s <= t)); return { i, p: clamp((t - STARTS[i]) / CHAPTERS[i].ms) }; };

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
  const pix = useLoad(() => territoryJSON('pix-adocao.json'), setFailure), rural = useLoad(() => territoryJSON('rural-2025.json'), setFailure);
  const savings = useLoad(() => territoryJSON('poupanca-grid.json'), setFailure), regions = useLoad(() => territoryJSON('ifdata-regiao.json'), setFailure);
  const [details, setDetails] = useState(null), [menu, setMenu] = useState(false);
  const detailsRequested = useRef(false);
  const loadDetails = useCallback(() => { if (detailsRequested.current) return; detailsRequested.current = true; territoryJSON('details.json').then(setDetails).catch(() => { detailsRequested.current = false; }); }, []);
  const openAnalysis = (event, id) => {
    const bank = catalog?.institutions.find(b => b.id === id);
    if (!bank || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpenInstitution(bank);
  };
  const go = (event, page) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setMenu(false); onNavigate(page); };

  const host = useRef(null), sceneLayer = useRef(null), veil = useRef(null), ridges = useRef(null), map = useRef(null), cams = useRef(null), raf = useRef(0), anim = useRef(null);
  const clock = useRef({ t: 0, playing: false, last: 0 }), lastData = useRef({}), lastUi = useRef(0), modeRef = useRef('film');
  const [ready, setReady] = useState(false), [mode, setMode] = useState('film'), [t, setT] = useState(0), [playing, setPlaying] = useState(false), [view, setView] = useState(null);
  const [selected, setSelected] = useState(null), [inst, setInst] = useState(null);
  const [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false), [active, setActive] = useState(0);
  const [person, setPerson] = useState('PF'), [manualSegment, setManualSegment] = useState(null), [info, setInfo] = useState(false);
  const instRef = useRef(null); instRef.current = inst;

  useMemo(() => { if (meta) for (const x of meta.institutions) if (BRAND[x.cnpjBase]) x.color = BRAND[x.cnpjBase]; }, [meta]);
  const rows = pointData?.rows, kinds = meta?.kinds;
  const placeByCode = useMemo(() => new Map((places || []).map(p => [p.ibge, p])), [places]);
  const cubes = useMemo(() => pf && pj ? { PF: makeCube(pf), PJ: makeCube(pj) } : null, [pf, pj]);
  const cube = cubes?.[person], ds = cube?.dims;
  const ufIndex = code => ds ? ds.ufs.findIndex(s => s.uf === code) : -1;
  const bands = ds ? ds.segments.map((s, i) => i).filter(i => ds.segments[i] !== 'Indisponível') : [];
  const { i: chapter, p } = chapterAt(t);
  const latest = ds ? ds.months.length - 1 : 0;
  // Ordem das redes: posição de cada instituição na sequência em que acende (0 a 6).
  const networkRank = useMemo(() => meta ? meta.institutions.map(x => { const k = NETWORK_ORDER.indexOf(x.cnpjBase); return k >= 0 ? k : x.segment === 'Cooperativa de Crédito' ? 5 : 6; }) : [], [meta]);
  const networkCounts = useMemo(() => { const c = new Array(7).fill(0); if (rows) for (const r of rows) c[networkRank[r[3]]]++; return c; }, [rows, networkRank]);
  const networkStep = chapter === 1 ? Math.min(6, Math.floor(clamp((p - .06) / .82) * 7)) : chapter > 1 ? 6 : -1;
  const inadMonth = chapter === 2 ? Math.min(latest, Math.floor(clamp(p / .85) * (latest + 1))) : latest;
  const filmSegment = chapter === 3 && p > .15 && p < .92 ? bands[Math.min(bands.length - 1, Math.floor((p - .15) / .77 * bands.length))] : -1;
  const segment = mode === 'explore' || manualSegment !== null ? (manualSegment ?? -1) : filmSegment;
  const pixMonth = pix ? (chapter === 4 ? Math.min(pix.months.length - 1, Math.floor(clamp((p - .15) / .8) * pix.months.length)) : pix.months.length - 1) : 0;
  const ruralMonth = rural ? (chapter === 7 ? clamp((p - .12) / .83) * (rural.months.length - 1) : rural.months.length - 1) : 0;
  const series = useMemo(() => cube ? ds.months.map((_, m) => ds.ufs.map((__, s) => rate(cube.get(m, segment, -1, s)))) : [], [cube, segment]);
  const ruralPoints = useMemo(() => places && rural ? places.filter(pl => rural.municipalities[pl.ibge] && pl.lon != null).map(pl => ({ type: 'Feature', id: +pl.ibge, geometry: { type: 'Point', coordinates: pl.visit || [pl.lon, pl.lat] }, properties: {} })) : null, [places, rural]);
  // Faixas do relevo da poupança: uma linha por faixa de latitude, uma amostra por célula de longitude.
  const ridgeRows = useMemo(() => {
    if (!savings) return null;
    const byBand = new Map(); let max = 0;
    for (const [a, b, v] of savings.cells) { if (!byBand.has(a)) byBand.set(a, new Map()); byBand.get(a).set(b, v); max = Math.max(max, v); }
    return { max, rows: [...byBand.entries()].sort((x, y) => y[0] - x[0]).map(([a, cells]) => { const keys = [...cells.keys()]; const lo = Math.min(...keys) - 3, hi = Math.max(...keys) + 3; const pts = []; for (let b = lo; b <= hi; b++) pts.push([b * savings.lonStep, a * savings.latStep, cells.get(b) || 0]); return pts; }) };
  }, [savings]);

  // Estado dos dados no mapa: UF, Pix, crédito rural e redes. Só reescreve quando o índice muda.
  useEffect(() => {
    const m = map.current; if (!ready || !ds) return;
    const key = person + segment + ':' + inadMonth; if (lastData.current.uf === key) return; lastData.current.uf = key;
    ds.ufs.forEach((s, i) => m.setFeatureState({ source: 'states', id: s.uf }, { rate: series[inadMonth]?.[i] ?? null }));
  }, [ready, ds, series, inadMonth, person, segment]);
  useEffect(() => {
    const m = map.current; if (!ready || !pix || lastData.current.pix === pixMonth) return; lastData.current.pix = pixMonth;
    for (const [code, values] of Object.entries(pix.municipalities)) m.setFeatureState({ source: 'municipalities', id: code }, { pix: values[pixMonth] });
  }, [ready, pix, pixMonth]);
  useEffect(() => {
    const m = map.current; if (!ready || !rural) return;
    const k = Math.round(ruralMonth * 8) / 8; if (lastData.current.rural === k) return; lastData.current.rural = k;
    const a = Math.floor(k), b = Math.min(a + 1, rural.months.length - 1), u = k - a;
    for (const [code, vals] of Object.entries(rural.municipalities)) m.setFeatureState({ source: 'rural', id: +code }, { v: lerp(vals[a], vals[b], u) });
  }, [ready, rural, ruralMonth]);
  useEffect(() => {
    const m = map.current; if (!ready || !m.getLayer('pts-exact')) return;
    const step = mode === 'explore' ? 6 : networkStep; if (lastData.current.net === step) return; lastData.current.net = step;
    const filter = rest => ['all', ['<=', ['get', 'n'], step], rest];
    m.setFilter('pts-exact', filter(['<', ['get', 'p'], 3]));
    m.setFilter('pts-loose', filter(['>=', ['get', 'p'], 3]));
  }, [ready, networkStep, mode]);

  useEffect(() => {
    if (!meta || !rows || !states || !municipalities || !places || !cubes || !pix || !rural || !ruralPoints || !savings || !regions || !host.current || map.current) return;
    const features = rows.map(r => { const x = meta.institutions[r[3]], g = kindGroup(meta.kinds[r[2]]); return { type: 'Feature', id: r[7], geometry: { type: 'Point', coordinates: [r[0], r[1]] }, properties: { i: r[3], p: r[4], n: networkRank[r[3]], c: x.color || KIND_COLOR[g] } }; });
    let m;
    try {
      maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href);
      m = new maplibregl.Map({ container: host.current, style: baseStyle(states, municipalities), center: [-26, -24], zoom: 2.9, minZoom: 2.4, maxZoom: 18, dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false, attributionControl: false, fadeDuration: 0 });
    } catch (e) { setFailure('O mapa não pôde ser aberto neste navegador.'); return; }
    map.current = m;
    // Começa quando o estilo está pronto; as telhas de relevo chegam com o filme já em curso.
    let started = false;
    const init = () => {
      if (started || !m.style?._loaded) return; started = true;
      m.addSource('rural', { type: 'geojson', data: { type: 'FeatureCollection', features: ruralPoints } });
      m.addLayer({ id: 'rural', type: 'circle', source: 'rural', paint: { 'circle-color': '#2f7a3e', 'circle-opacity': 0, 'circle-stroke-color': '#eef4e8', 'circle-stroke-width': .6, 'circle-stroke-opacity': 0,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['*', .62, ['sqrt', ['coalesce', ['feature-state', 'v'], 0]]], 8, ['*', 1.6, ['sqrt', ['coalesce', ['feature-state', 'v'], 0]]]] } }, 'country');
      m.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      const radius = ['interpolate', ['linear'], ['zoom'], 3, 1.3, 6, 2.1, 9, 3.2, 12, 4.8, 16, 7];
      m.addLayer({ id: 'pts-loose', type: 'circle', source: 'pts', filter: ['>=', ['get', 'p'], 3], paint: { 'circle-color': ['get', 'c'], 'circle-radius': radius, 'circle-opacity': 0 } });
      m.addLayer({ id: 'pts-exact', type: 'circle', source: 'pts', filter: ['<', ['get', 'p'], 3], paint: { 'circle-color': ['get', 'c'], 'circle-radius': radius, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, .25, 11, 1], 'circle-opacity': 0, 'circle-stroke-opacity': 0 } });
      m.addLayer({ id: 'pts-inst', type: 'circle', source: 'pts', filter: ['==', ['get', 'i'], -1], paint: { 'circle-color': ['get', 'c'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 8, 3.6, 12, 6, 16, 8.5], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0.3, 10, 1.2] } });
      m.addLayer({ id: 'pts-selected', type: 'circle', source: 'pts', filter: ['==', ['id'], -1], paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 14, 13], 'circle-stroke-color': '#0f2633', 'circle-stroke-width': 2.2 } });
      for (const id of LAYERS) { m.on('mouseenter', id, () => { if (modeRef.current === 'explore') m.getCanvas().style.cursor = 'pointer'; }); m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; }); }
      m.on('click', e => {
        const hit = m.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: LAYERS });
        if (hit.length && m.getPaintProperty('pts-exact', 'circle-opacity') > 0.3) choosePoint(hit[0].id, false);
      });
      computeCameras(); setReady(true);
      // O filme começa ao carregar, inclusive com movimento reduzido; um gesto no mapa interrompe o percurso.
      clock.current.playing = true; clock.current.last = 0; setPlaying(true);
    };
    m.on('style.load', init); m.on('styledata', init); m.on('load', init);
    const poll = setInterval(() => { init(); if (started) clearInterval(poll); }, 100);
    m.on('moveend', () => updateView());
    m.on('idle', () => updateView());
    m.on('dragstart', e => { if (e.originalEvent) takeControl(); });
    m.on('zoomstart', e => { if (e.originalEvent) takeControl(); });
    m.getCanvasContainer().addEventListener('wheel', () => takeControl(), { passive: true });
    const ro = new ResizeObserver(() => { m.resize(); computeCameras(); }); ro.observe(host.current);
    return () => { clearInterval(poll); ro.disconnect(); cancelAnimationFrame(raf.current); m.remove(); map.current = null; };
  }, [meta, rows, states, municipalities, places, cubes, pix, rural, ruralPoints, savings, regions]);

  // Câmeras no tamanho atual do mapa (tela cheia no filme, ao lado da coluna na exploração).
  function computeCameras() {
    const m = map.current; if (!m || !places || !pix) return;
    const film = modeRef.current === 'film';
    const c = m.cameraForBounds(BR_BOUNDS, { padding: film ? FILM_PAD : PAD });
    const w = m.getCanvas().clientWidth, h = m.getCanvas().clientHeight, k = Math.log2(Math.min(w, h * 1.25) / 1000);
    const top = places.find(pl => pl.ibge === pix.facts.highest.ibge);
    const brasil = { center: [c.center.lng, c.center.lat], zoom: c.zoom };
    cams.current = { sea: { center: [-24, -26], zoom: brasil.zoom - .2 }, brasil, perto: { center: brasil.center, zoom: brasil.zoom + .25 }, fronteira: { center: top ? (top.visit || [top.lon, top.lat]) : brasil.center, zoom: 7.3 + k }, campo: { center: [brasil.center[0] - 2.5, brasil.center[1] - 1.5], zoom: brasil.zoom + .35 } };
  }
  function cameraAt(i, p) {
    const C = cams.current, w = map.current.getCanvas().clientWidth;
    const legs = [[C.sea, C.brasil, 0, 1], [C.brasil, C.perto, 0, 1], [C.perto, C.brasil, 0, .3], [C.brasil, C.brasil, 0, 1], [C.brasil, C.brasil, 0, 1], [C.brasil, C.fronteira, 0, .55], [C.fronteira, C.brasil, 0, .35], [C.brasil, C.campo, 0, .4]][i];
    const u = smooth(clamp((p - legs[2]) / (legs[3] - legs[2])));
    return fromView(interpolateZoom(toView(legs[0], w), toView(legs[1], w))(u), w);
  }
  // Opacidade das camadas por capítulo, com as passagens no início de cada um.
  function lookAt(i, p) {
    const fadeIn = (a = .12) => clamp(p / a);
    const L = { scene: 0, uf: 0, pts: 0, pix: 0, rural: 0, ridge: 0 };
    if (i === 1) L.pts = 1;
    if (i === 2) { L.pts = 1 - fadeIn(.2); L.uf = .85 * fadeIn(.2); }
    if (i === 3) { L.scene = fadeIn(.1); L.uf = .85; }
    if (i === 4) { L.scene = 1 - fadeIn(.1); L.uf = .85 * (1 - fadeIn(.15)); L.pix = fadeIn(.15) * .85; }
    if (i === 5) { L.pix = .85; L.pts = clamp((p - .55) / .2) * .8; }
    if (i === 6) { L.pix = .85 * (1 - fadeIn(.15)); L.pts = .8 * (1 - fadeIn(.15)); L.ridge = clamp((p - .3) / .1); }
    if (i === 7) { L.ridge = 1 - fadeIn(.1); L.rural = clamp((p - .08) / .1); }
    return L;
  }
  function applyLook(L) {
    const m = map.current; if (!m?.getLayer('pts-exact')) return;
    const pts = instRef.current != null ? .12 : L.pts;
    const key = [L.scene, L.uf, pts, L.pix, L.rural, L.ridge].map(v => v.toFixed(3)).join(); if (key === lastData.current.look) return; lastData.current.look = key;
    if (sceneLayer.current) { sceneLayer.current.style.opacity = L.scene; sceneLayer.current.style.visibility = L.scene > .01 ? 'visible' : 'hidden'; sceneLayer.current.style.pointerEvents = L.scene > .5 ? 'auto' : 'none'; }
    if (veil.current) veil.current.style.opacity = L.scene;
    if (ridges.current) { ridges.current.style.opacity = L.ridge; ridges.current.style.visibility = L.ridge > .01 ? 'visible' : 'hidden'; }
    m.setPaintProperty('uf-fill', 'fill-opacity', L.uf);
    m.setPaintProperty('muni-pix', 'fill-opacity', L.pix);
    m.setPaintProperty('pts-exact', 'circle-opacity', pts);
    m.setPaintProperty('pts-exact', 'circle-stroke-opacity', pts);
    m.setPaintProperty('pts-loose', 'circle-opacity', ['interpolate', ['linear'], ['zoom'], 10.5, pts, 12.5, pts * .18]);
    m.setPaintProperty('rural', 'circle-opacity', L.rural * .62);
    m.setPaintProperty('rural', 'circle-stroke-opacity', L.rural * .9);
  }
  const EXPLORE = { scene: 0, uf: 0, pts: 1, pix: 0, rural: 0, ridge: 0 };

  // Relevo da poupança: linhas desenhadas sobre o mapa, projetadas a cada quadro do capítulo.
  function drawRidges(grow) {
    const svg = ridges.current, m = map.current; if (!svg || !m || !ridgeRows) return;
    const h = Math.min(170, m.getCanvas().clientHeight * .24), out = [];
    for (const row of ridgeRows.rows) {
      let d = '', x0 = 0, x1 = 0, yb = 0;
      row.forEach(([lon, lat, v], j) => { const q = m.project([lon, lat]); const y = q.y - h * Math.sqrt(v / ridgeRows.max) * grow; d += (j ? 'L' : 'M') + q.x.toFixed(1) + ' ' + y.toFixed(1); if (!j) x0 = q.x; x1 = q.x; yb = q.y; });
      out.push(`<path d="${d}L${x1.toFixed(1)} ${yb.toFixed(1)}L${x0.toFixed(1)} ${yb.toFixed(1)}Z" class="ridge-fill"/><path d="${d}" class="ridge-line"/>`);
    }
    svg.innerHTML = out.join('');
  }

  // Relógio do filme: câmera em todo quadro; a interface se atualiza a ~15 quadros por segundo.
  useEffect(() => {
    if (!ready) return;
    const tick = now => {
      const c = clock.current;
      if (c.playing && modeRef.current === 'film') {
        c.t = Math.min(TOTAL, c.t + (c.last ? Math.min(400, now - c.last) : 0));
        if (c.t >= TOTAL) { c.playing = false; setPlaying(false); converge(true); }
      }
      c.last = now;
      if (modeRef.current === 'film') {
        const { i, p } = chapterAt(c.t);
        map.current.jumpTo(cameraAt(i, p)); const L = lookAt(i, p); applyLook(L);
        if (L.ridge > .01) drawRidges(i === 6 ? smooth(clamp((p - .3) / .5)) : 1);
        if (now - lastUi.current > 66) { lastUi.current = now; setT(c.t); }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [ready, ridgeRows]);

  function play() {
    const c = clock.current;
    if (c.playing) { c.playing = false; setPlaying(false); return; }
    if (modeRef.current === 'explore') { modeRef.current = 'film'; setMode('film'); setManualSegment(null); clearInst(); clearPoint(); lastData.current.look = null; requestAnimationFrame(computeCameras); c.t = 0; }
    if (c.t >= TOTAL) c.t = 0;
    c.playing = true; c.last = 0; setPlaying(true);
  }
  function jump(i) {
    const c = clock.current; c.t = STARTS[i] + 1; c.last = 0; c.playing = true; setPlaying(true);
    if (modeRef.current !== 'film') { modeRef.current = 'film'; setMode('film'); requestAnimationFrame(computeCameras); }
    setManualSegment(null); clearInst(); clearPoint(); lastData.current.look = null; setT(c.t);
  }
  // Fim do percurso (ou qualquer gesto): o mapa abre espaço para a coluna e passa a mostrar as unidades.
  function converge(recenter) {
    modeRef.current = 'explore'; setMode('explore'); lastData.current.look = null; applyLook(EXPLORE);
    if (recenter) setTimeout(() => { const m = map.current; if (!m) return; const c = m.cameraForBounds(BR_BOUNDS, { padding: PAD }); flyTo({ center: [c.center.lng, c.center.lat], zoom: c.zoom }, true); }, 720);
    setTimeout(updateView, 800);
  }
  function takeControl() {
    cancelAnim();
    const c = clock.current; if (c.playing) { c.playing = false; setPlaying(false); }
    if (modeRef.current !== 'explore') converge(false);
  }
  function cancelAnim() { if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; } }
  function flyTo(camera, keep = false) {
    const m = map.current; if (!m) return; if (!keep) takeControl(); cancelAnim();
    const width = m.getCanvas().clientWidth || 800;
    const f = interpolateZoom(toView({ center: m.getCenter().toArray(), zoom: m.getZoom() }, width), toView(camera, width));
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : clamp(f.duration * 650, 700, 2600), start = performance.now();
    const step = () => { const k = ms ? clamp((performance.now() - start) / ms) : 1; m.jumpTo(fromView(f(smooth(k)), width)); anim.current = k < 1 ? requestAnimationFrame(step) : null; };
    step();
  }
  useEffect(() => { const k = e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); play(); } if (e.key === 'Escape') { clearPoint(); setSearchOpen(false); setInfo(false); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [ready]);

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

  function choosePoint(idx, fly = true) {
    loadDetails(); setSelected(idx);
    const m = map.current, r = rows[idx];
    m?.setFilter('pts-selected', ['==', ['id'], idx]);
    if (fly) flyTo({ center: [r[0], r[1]], zoom: Math.max(15, m.getZoom()) }); else takeControl();
  }
  function clearPoint() { setSelected(null); if (map.current?.getLayer('pts-selected')) map.current.setFilter('pts-selected', ['==', ['id'], -1]); }
  function chooseInst(i) {
    setInst(i); instRef.current = i;
    const m = map.current; if (!m) return;
    m.setFilter('pts-inst', ['==', ['get', 'i'], i]);
    lastData.current.look = null; applyLook(EXPLORE);
  }
  function clearInst() { setInst(null); instRef.current = null; if (map.current?.getLayer('pts-inst')) map.current.setFilter('pts-inst', ['==', ['get', 'i'], -1]); lastData.current.look = null; if (modeRef.current === 'explore') applyLook(EXPLORE); }

  const results = useMemo(() => {
    const q = norm(query); if (!q || !meta || !places) return [];
    const toks = q.split(' '), out = [];
    places.filter(pl => toks.every(tk => norm(pl.name + ' ' + pl.uf).includes(tk))).sort((a, b) => (b.agencias + b.postos) - (a.agencias + a.postos)).slice(0, 4)
      .forEach(pl => out.push({ type: 'place', key: 'p' + pl.ibge, label: pl.name, sub: pl.uf, p: pl }));
    meta.institutions.map((x, i) => ({ x, i })).filter(({ x }) => toks.every(tk => norm(x.name + ' ' + x.legalName).includes(tk))).sort((a, b) => b.x.count - a.x.count).slice(0, 4)
      .forEach(({ x, i }) => out.push({ type: 'inst', key: 'i' + i, label: x.name, sub: nf(x.count) + ' unidades', i }));
    if (details && q.length >= 3) {
      let n = 0;
      for (let j = 0; j < details.length && n < 4; j++) {
        const d = details[j];
        if (toks.every(tk => norm(d.unit + ' ' + d.address + ' ' + d.bairro + ' ' + (placeByCode.get(d.ibge)?.name || '')).includes(tk))) {
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

  const header = <header className="atlas-site-header">
    <a className="territory-title" href={BASE} onClick={e => go(e, 'overview')}><Wordmark /></a>
    <button className="atlas-menu" aria-label="Menu" aria-expanded={menu} aria-controls="territory-nav" onClick={() => setMenu(v => !v)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" /></svg></button>
    <nav id="territory-nav" className={menu ? 'is-open' : ''} aria-label="Navegação principal">{APP_NAVIGATION.map(([k, l]) => <a key={k} href={BASE + '?view=' + k} onClick={e => go(e, k)}>{l}</a>)}</nav>
  </header>;
  if (!meta || !rows || !places || !cubes || !states || !pix || !rural || !savings || !regions) return <main className="territory loading">{header}<p role={failure ? 'alert' : 'status'}>{failure || 'Carregando…'}</p>{failure && <button onClick={() => location.reload()}>Recarregar</button>}</main>;
  const c = meta.counts, instInfo = inst != null ? meta.institutions[inst] : null;
  const scope = segment < 0 ? (person === 'PF' ? 'Todas as rendas' : 'Todos os portes') : ds.segments[segment];
  const viewIdx = mode === 'explore' ? ufIndex(view?.uf) : -1;
  const muni = view?.muni ? placeByCode.get(view.muni) : null;
  const sel = selected != null ? rows[selected] : null, selD = selected != null && details ? details[selected] : null, selInst = sel ? meta.institutions[sel[3]] : null;
  const top = placeByCode.get(pix.facts.highest.ibge), pixLast = pix.months.length - 1;
  const pixPct = v => v == null ? 'N/D' : nf(v / 10, 1).replace(',0', '') + '%';
  const muniPix = muni ? pix.municipalities[muni.ibge] : null;
  const rk = Math.round(ruralMonth);
  const sceneLayout = chapter === 3 && p > .1 && p < .95 ? 'distribution' : 'map';
  const highlights = chapter === 3 ? ['AM', 'SP'].map((s, i) => ({ index: ufIndex(s), color: i ? '#ec7000' : '#315f78' })) : [];
  const networkNames = [...NETWORK_ORDER.map(k => meta.institutions.find(x => x.cnpjBase === k)), { name: 'Cooperativas', color: KIND_COLOR.cooperativa }, { name: 'Demais instituições', color: KIND_COLOR.agencia }];
  const regionLine = x => { const r = x?.analysisCode && regions.institutions[x.analysisCode]; if (!r || !r['Total Geral']) return null; return REGIONS.map(([k, label]) => [label, (r[k] || 0) / r['Total Geral']]).filter(([, v]) => v >= .005).sort((a, b) => b[1] - a[1]).map(([label, v]) => `${label} ${nf(v * 100, 0)}%`).join(' · '); };
  const personSwitch = <div className="atlas-person-switch" role="group" aria-label="Tipo de cliente"><button aria-pressed={person === 'PF'} onClick={() => setPerson('PF')}>Pessoas físicas</button><button aria-pressed={person === 'PJ'} onClick={() => setPerson('PJ')}>Pessoas jurídicas</button></div>;
  const ticks = <div className="atlas-segment-ticks">{[-1, ...bands].map(i => <button key={i} aria-pressed={segment === i} aria-label={i < 0 ? 'Todas' : ds.segments[i]} onClick={() => { setManualSegment(i); if (clock.current.playing) { clock.current.playing = false; setPlaying(false); } }}>{i < 0 ? 'Todas' : compactSegment(ds.segments[i], ds.segmentKind)}</button>)}</div>;

  // Legenda de cada capítulo, sobre o mapa: leitura, no máximo uma frase e a fonte.
  const caption = [
    null,
    <><h2>Agências e postos</h2><p className="network-now">{networkStep >= 0 && <><i style={{ background: networkNames[networkStep].color }} />{networkNames[networkStep].name} <span>{nf(networkCounts[networkStep])} unidades</span></>}</p>
      <p className="src">{nf(c.kinds.agencia)} agências e {nf(c.units - c.kinds.agencia)} postos no endereço cadastrado. BCB, 05/11/2026; CNEFE 2022 (IBGE).</p></>,
    <><h2>Inadimplência</h2><div className="atlas-reading"><strong>{percent(rate(cube.get(inadMonth, -1, -1)))}</strong><span>{siteMonth(ds.months[inadMonth])}</span></div>
      <div className="atlas-rate-legend">{ATLAS_RATE_SCALE.map((item, i) => <span key={item.min}><i style={{ background: item.color }} />{item.min}{i === 5 ? '%+' : ''}</span>)}</div>
      <p className="src">Pessoas físicas, por UF do tomador. BCB, SCR.data.</p></>,
    <><h2>{person === 'PF' ? 'Por renda' : 'Por porte'}</h2><div className="atlas-reading"><strong>{percent(rate(cube.get(latest, segment, -1)))}</strong><span>{scope}</span></div>
      <p className="src">Cada ponto é uma UF, na posição da sua taxa. BCB, SCR.data, {siteMonth(ds.months[latest])}.</p></>,
    <><h2>Pix</h2><div className="atlas-reading"><strong>{pixPct(pix.national[pixMonth])}</strong><span>da população pagou com Pix em {ym(pix.months[pixMonth])}</span></div>
      <div className="atlas-rate-legend">{PIX_STOPS.map(([v, col], i) => <span key={v}><i style={{ background: col }} />{v / 10}{i === PIX_STOPS.length - 1 ? '%+' : ''}</span>)}</div>
      <p className="src">Por município. BCB, Pix por município; IBGE, população 2025.</p></>,
    <><h2>{top ? top.name : 'Fronteira'}</h2><p>{pix.facts.highest.ibge === '1400456' ? 'Na fronteira com a Venezuela, ' : ''}{nf(pix.facts.highest.payers)} pessoas pagaram com Pix em {ym(pix.months[pixLast])}. A população estimada é de {nf(pix.facts.highest.population)}.</p>
      <p className="src">O BCB não publica como atribui o município ao pagador.</p></>,
    <><h2>Poupança</h2><div className="atlas-reading"><strong>R$ {nf(savings.totalBi, 0)} bi</strong><span>em {nf(savings.agencies)} agências, jun/2026</span></div>
      <p className="src">Saldo somado em faixas de 0,4° de latitude por 0,25° de longitude; altura proporcional à raiz do saldo. BCB, ESTBAN. Cooperativas não entram.</p></>,
    <><h2>Crédito rural</h2><div className="atlas-reading"><strong>R$ {nf(rural.totalBi[rk], 1)} bi</strong><span>contratados em {ym(rural.months[rk])}</span></div>
      <p className="src">Pelo município do empreendimento. BCB, SICOR; {nf(rural.coverage.operations * 100, 0)}% das operações e {nf(rural.coverage.value * 100, 0)}% do valor de 2025 trazem município.</p></>,
  ];

  return <main className={'territory atlas-landing mode-' + mode + (mode === 'film' && (chapter === 3 || !ready) ? ' on-paper' : '')}>
    {header}
    <div className="body">
      <aside className="column" aria-hidden={mode === 'film'}>
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
        <section className="explore">
          {sel && <div className="unit">
            <button className="close" aria-label="Fechar" onClick={clearPoint}>×</button>
            <p className="kicker"><i style={{ background: selInst.color || KIND_COLOR[kindGroup(kinds[sel[2]])] }} />{KIND_LABEL[kinds[sel[2]]]} · {selInst.name}</p>
            <h2>{selD ? pretty(selD.unit || selD.address) : '…'}</h2>
            {selD && <p className="address">{pretty(selD.address)}{selD.bairro ? ', ' + pretty(selD.bairro) : ''}<br />{placeByCode.get(selD.ibge)?.name} ({placeByCode.get(selD.ibge)?.uf})</p>}
            {selD?.estban && <dl className="balances"><div><dt>Crédito na agência</dt><dd>{money(selD.estban.credito)}</dd></div><div><dt>Poupança</dt><dd>{money(selD.estban.poupanca)}</dd></div></dl>}
            {selD?.estban && <p className="src">ESTBAN jun/2026, saldo registrado nesta agência.</p>}
            {sel[4] >= 3 && <p className="src">{PRECISION_LABEL[meta.precision[sel[4]]]}.</p>}
            {selInst.analysisId && <a className="analyze" href={ANALYSIS + selInst.analysisId} onClick={e => openAnalysis(e, selInst.analysisId)}>Analisar {selInst.name}</a>}
          </div>}
          <div className="place"><h2>{muni ? muni.name : viewIdx >= 0 ? ds.ufs[viewIdx].name : 'Brasil'}</h2>{muni && <span>{muni.uf}</span>}</div>
          {view && <p className="counts">{nf(view.counts.agencia)} agências · {nf(view.counts.postos)} postos{muniPix ? ` · Pix: ${pixPct(muniPix[pixLast])} da população pagou em ${ym(pix.months[pixLast])}` : ''}</p>}
          {instInfo && <div className="inst-detail"><div className="inst-chip"><i style={{ background: instInfo.color || KIND_COLOR.agencia }} /><span>{instInfo.name}</span><button aria-label="Todas as instituições" onClick={clearInst}>×</button>{instInfo.analysisId && <a className="analyze" href={ANALYSIS + instInfo.analysisId} onClick={e => openAnalysis(e, instInfo.analysisId)}>Analisar</a>}</div>
            {regionLine(instInfo) && <p className="src">Carteira de crédito por região do tomador: {regionLine(instInfo)}. IF.data, {ym(regions.period)}, conglomerado prudencial.</p>}</div>}
          {view?.topInst.length > 0 && !instInfo && <ol className="insts">{view.topInst.map(([i, n]) => { const x = meta.institutions[i]; return <li key={i}><button onClick={() => chooseInst(i)}>
            <span className="bar" style={{ width: (100 * n / view.topInst[0][1]) + '%', background: x.color || (x.segment === 'Cooperativa de Crédito' ? KIND_COLOR.cooperativa : KIND_COLOR.agencia) }} /><span className="name">{x.name}</span><span className="n">{nf(n)}</span></button></li>; })}</ol>}
          <div className="credit-block">
            <h3>Inadimplência{viewIdx >= 0 ? ' em ' + ds.ufs[viewIdx].name : ' no Brasil'}</h3>
            {personSwitch}
            <div className="atlas-reading small"><strong>{percent(rate(cube.get(latest, segment, -1, viewIdx)))}</strong><span>{scope} · {siteMonth(ds.months[latest])}</span>{viewIdx >= 0 && <small>Brasil: {percent(rate(cube.get(latest, segment, -1)))}</small>}</div>
            {ticks}
          </div>
          <div className="replay"><button className="atlas-play" onClick={play} aria-label="Rever o percurso"><svg viewBox="0 0 20 20"><path d="M7 5l8 5-8 5z" /></svg></button><span>Rever o percurso</span>
            <ol>{CHAPTERS.map((ch, i) => i > 0 && <li key={ch.id}><button onClick={() => jump(i)}>{ch.id === 'fronteira' && top ? top.name : ch.label}</button></li>)}</ol></div>
        </section>
      </aside>

      <div className="stage">
        <div className="map" ref={host} />
        <div className="grain" aria-hidden="true" />
        <svg className="ridges" ref={ridges} aria-hidden="true" />
        <div className="veil" ref={veil} />
        <div className="scene-layer" ref={sceneLayer}>
          <AtlasScene geo={states} states={ds.ufs} series={series} month={latest} layout={sceneLayout} selected={-1} highlights={highlights} playing={false} onSelect={() => {}} onMonthChange={() => {}} onPlayingChange={() => {}} motionRequested />
        </div>
        {mode === 'film' && !ready && <p className="film-loading" role="status">Carregando o relevo e os dados…</p>}
        {mode === 'film' && caption[chapter] && <div className="caption" aria-live="off">{caption[chapter]}</div>}
        {mode === 'film' && <nav className="film-bar" aria-label="Percurso">
          <button className="atlas-play" onClick={play} aria-label={playing ? 'Pausar' : 'Reproduzir'}>{playing ? <svg viewBox="0 0 20 20"><path d="M7 5v10M13 5v10" /></svg> : <svg viewBox="0 0 20 20"><path d="M7 5l8 5-8 5z" /></svg>}</button>
          <ol>{CHAPTERS.map((ch, i) => <li key={ch.id} style={{ flex: ch.ms }}><button onClick={() => jump(i)} aria-current={chapter === i ? 'step' : undefined}><span className="track"><span style={{ width: (i < chapter ? 100 : chapter === i ? p * 100 : 0) + '%' }} /></span><span className="label">{ch.id === 'fronteira' && top ? top.name : ch.label}</span></button></li>)}</ol>
          <button className="skip" onClick={() => { clock.current.playing = false; setPlaying(false); converge(true); }}>Explorar</button>
        </nav>}
        {mode === 'explore' && <div className="atlas-scene-camera map-zoom"><button aria-label="Aproximar" onClick={() => map.current?.zoomIn({ duration: 300 })}><svg viewBox="0 0 20 20"><path d="M4 10h12M10 4v12" /></svg></button><button aria-label="Afastar" onClick={() => map.current?.zoomOut({ duration: 300 })}><svg viewBox="0 0 20 20"><path d="M4 10h12" /></svg></button></div>}
        {mode === 'explore' && <div className="atlas-source"><span>Relevo: Terrain Tiles (Mapzen) · base OpenFreeMap, © OpenStreetMap · malhas IBGE</span><button aria-label="Notas sobre os dados" aria-expanded={info} onClick={() => setInfo(v => !v)}><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5M10 6.2v.1" /></svg></button></div>}
        {info && <aside className="atlas-data-info"><button aria-label="Fechar" onClick={() => setInfo(false)}>×</button>
          <p>Agências e postos: {nf(100 * ((c.precision.numero || 0) + (c.precision.numero_aproximado || 0) + (c.precision.logradouro || 0)) / c.located, 0)}% localizados pelo número ou pela rua; os demais, por CEP, bairro ou município, quase somem na escala de rua. Cores dos cinco maiores bancos; cooperativas em verde; demais instituições em azul-petróleo.</p>
          <p>Pix: pessoas físicas pagadoras no mês divididas pela população estimada de 2025 em todos os meses; a razão pode passar de 100%. Mês corrente excluído por estar incompleto.</p>
          <p>Poupança e crédito por agência: ESTBAN jun/2026, onde a operação é contabilizada. Crédito rural: grandes operações de comercialização e industrialização costumam vir sem município e ficam fora do mapa.</p>
        </aside>}
      </div>
    </div>
  </main>;
}
