import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geoArea, geoCentroid, geoMercator, geoPath } from 'd3-geo';
import '../atlas-landing.css';
import './territory.css';
// Cálculos de inadimplência do próprio site: mesma regra de taxa.
import { makeCube, rate, percent, monthLabel as siteMonth } from '../atlas-data.js';
import { WEB_CHART_COLORS } from '../chart-palette.js';
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
const FILM_PAD = { top: 40, bottom: 40, left: 40, right: 40 };
const VEIL = .84;

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
  { id: 'rede', label: 'Agências', ms: 13000 },
  { id: 'pix', label: 'Pix', ms: 12000 },
  { id: 'fronteira', label: 'Pacaraima', ms: 6500 },
  { id: 'inad', label: 'Inadimplência', ms: 16000 },
  { id: 'renda', label: 'Por renda', ms: 20000 },
  { id: 'poupanca', label: 'Poupança', ms: 12000 },
  { id: 'rural', label: 'Crédito rural', ms: 12000 },
];
const AT = Object.fromEntries(CHAPTERS.map((c, i) => [c.id, i]));
const STARTS = CHAPTERS.reduce((a, c, i) => (a.push(i ? a[i - 1] + CHAPTERS[i - 1].ms : 0), a), []);
const TOTAL = STARTS.at(-1) + CHAPTERS.at(-1).ms;
const chapterAt = t => { const i = Math.max(0, STARTS.findLastIndex(s => s <= t)); return { i, p: clamp((t - STARTS[i]) / CHAPTERS[i].ms) }; };
// Inadimplência em gráfico. Cada UF sai do mapa como ponto, vira o contorno do estado e se acomoda em eixos:
// x pela longitude do centro da UF (oeste à esquerda), y pela taxa, com base em zero. Cor pela região.
// Os valores vêm do relógio do filme: entre meses, spline de Catmull-Rom; entre faixas, uma onda de oeste a leste.
// O eixo y acompanha a faixa mostrada; a linha do Brasil fica como referência.
const REGION = { 1: ['Norte', WEB_CHART_COLORS[4]], 2: ['Nordeste', WEB_CHART_COLORS[1]], 5: ['Centro-Oeste', WEB_CHART_COLORS[7]], 3: ['Sudeste', WEB_CHART_COLORS[2]], 4: ['Sul', WEB_CHART_COLORS[0]] };
const UF_REGION = { AC: 1, AM: 1, AP: 1, PA: 1, RO: 1, RR: 1, TO: 1, AL: 2, BA: 2, CE: 2, MA: 2, PB: 2, PE: 2, PI: 2, RN: 2, SE: 2, ES: 3, MG: 3, RJ: 3, SP: 3, PR: 4, RS: 4, SC: 4, DF: 5, GO: 5, MS: 5, MT: 5 };
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const MONTHS_FROM = .42, MONTHS_TO = .96;
const monthPos = (p, last) => clamp((p - MONTHS_FROM) / (MONTHS_TO - MONTHS_FROM)) * last;
const MOVE = .58, WAVE = .14;
const bandSlot = (p, n) => { const pos = clamp((p - .1) / .86) * n, j = Math.min(n - 1, Math.floor(pos)); return { j, raw: clamp((pos - j) / MOVE) }; };
const bandPos = (p, n) => { const { j, raw } = bandSlot(p, n); return { j, u: easeInOut(raw) }; };
const catmull = (a, b, c, d, t) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
function chartState(S, id, p) {
  const last = S.months.length - 1;
  if (id === 'inad') {
    const pos = monthPos(p, last), a = Math.floor(pos), b = Math.min(last, a + 1), t = pos - a, A = S.months[Math.max(0, a - 1)], B = S.months[a], C = S.months[b], D = S.months[Math.min(last, b + 1)];
    const rates = B.map((v, j) => v != null && C[j] != null ? Math.max(0, catmull(A[j] ?? v, v, C[j], D[j] ?? C[j], t)) : t < .5 ? v : C[j]);
    const n = S.nationalMonths;
    return { rates, national: catmull(n[Math.max(0, a - 1)], n[a], n[b], n[Math.min(last, b + 1)], t), month: Math.round(pos), band: -1, yMax: S.yMonths };
  }
  if (id === 'renda') {
    const { j, raw } = bandSlot(p, S.seq.length - 1), from = S.seq[j], to = S.seq[j + 1], u = easeInOut(raw), F = S.byBand.get(from), T = S.byBand.get(to);
    const rates = F.map((v, k) => { const w = easeInOut(clamp((raw - WAVE * S.wave[k]) / (1 - WAVE))); return v != null && T[k] != null ? v + (T[k] - v) * w : w < .5 ? v : T[k]; });
    return { rates, national: lerp(S.nationalBand.get(from), S.nationalBand.get(to), u), month: last, band: u < .5 ? from : to, yMax: lerp(S.yBand.get(from), S.yBand.get(to), u) };
  }
  return { rates: S.byBand.get(-1), national: S.nationalBand.get(-1), month: last, band: -1, yMax: S.yBand.get(-1) };
}
// Contorno de cada UF em miniatura (26 px); d3 exige anéis no sentido horário.
function upright(feature) {
  if (geoArea(feature) <= 2 * Math.PI) return feature;
  const flip = rings => rings.map(r => r.slice().reverse());
  const g = feature.geometry;
  return { ...feature, geometry: { ...g, coordinates: g.type === 'Polygon' ? flip(g.coordinates) : g.coordinates.map(flip) } };
}

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

  const host = useRef(null), chart = useRef(null), veil = useRef(null), ridges = useRef(null), map = useRef(null), cams = useRef(null), raf = useRef(0), anim = useRef(null);
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
  const networkStep = chapter === AT.rede ? Math.min(6, Math.floor(clamp((p - .06) / .82) * 7)) : chapter > AT.rede ? 6 : -1;
  const inadMonth = chapter === AT.inad ? Math.round(monthPos(p, latest)) : latest;
  const filmSegment = chapter === AT.renda ? (() => { const seq = [-1, ...bands, -1], { j, u } = bandPos(p, seq.length - 1); return u < .5 ? seq[j] : seq[j + 1]; })() : -1;
  const segment = mode === 'explore' || manualSegment !== null ? (manualSegment ?? -1) : filmSegment;
  const pixMonth = pix ? (chapter === AT.pix ? Math.min(pix.months.length - 1, Math.floor(clamp((p - .15) / .8) * pix.months.length)) : pix.months.length - 1) : 0;
  const ruralMonth = rural ? (chapter === AT.rural ? clamp((p - .12) / .83) * (rural.months.length - 1) : rural.months.length - 1) : 0;
  const series = useMemo(() => cube ? ds.months.map((_, m) => ds.ufs.map((__, s) => rate(cube.get(m, segment, -1, s)))) : [], [cube, segment]);
  // Gráfico da inadimplência: taxa de cada UF por mês (todas as faixas) e, no último mês, por faixa. Lido pelo relógio do filme.
  const chartRef = useRef(null), chartX = useRef(null), chartY = useRef(null), chartDom = useRef(null);
  chartRef.current = useMemo(() => {
    if (!cube || !states) return null;
    const last = ds.months.length - 1, list = ds.segments.map((_, i) => i).filter(i => ds.segments[i] !== 'Indisponível');
    const shapes = ds.ufs.map(u => {
      const f = states.features.find(x => x.properties?.uf === u.uf); if (!f) return null;
      const g = upright(f), path = geoPath(geoMercator().fitSize([26, 26], g)).digits(1), b = path.bounds(g);
      return { center: geoCentroid(g), d: path(g), cx: (b[0][0] + b[1][0]) / 2, cy: (b[0][1] + b[1][1]) / 2, name: u.name, color: REGION[UF_REGION[u.uf]]?.[1] || '#16323f' };
    });
    const months = ds.months.map((_, m) => ds.ufs.map((__, s) => rate(cube.get(m, -1, -1, s))));
    const byBand = new Map([-1, ...list].map(b => [b, ds.ufs.map((_, s) => rate(cube.get(last, b, -1, s)))]));
    const top = rows => Math.max(...rows.flat().filter(v => v != null));
    const lons = shapes.filter(Boolean).map(sh => sh.center[0]), lon0 = Math.min(...lons), lon1 = Math.max(...lons);
    // Eixo: 12% acima da maior taxa mostrada, arredondado ao ponto percentual. "Todas" no último mês usa o eixo dos meses.
    const yMonths = Math.ceil(top(months) * 1.12), yBand = new Map([...byBand].map(([b, row]) => [b, b < 0 ? yMonths : Math.ceil(top([row]) * 1.12)]));
    return { shapes, months, byBand, yMonths, yBand, seq: [-1, ...list, -1], lon0, lon1, wave: shapes.map(sh => sh ? (sh.center[0] - lon0) / (lon1 - lon0) : 0),
      nationalMonths: ds.months.map((_, m) => rate(cube.get(m, -1, -1))), nationalBand: new Map([-1, ...list].map(b => [b, rate(cube.get(last, b, -1))])) };
  }, [cube, states]);
  const ruralPoints = useMemo(() => places && rural ? places.filter(pl => rural.municipalities[pl.ibge] && pl.lon != null).map(pl => ({ type: 'Feature', id: +pl.ibge, geometry: { type: 'Point', coordinates: pl.visit || [pl.lon, pl.lat] }, properties: {} })) : null, [places, rural]);
  // Relevo da poupança. As células do ESTBAN (0,4° × 0,25°) são somadas em faixas de 0,8° de latitude; ao longo de cada
  // faixa, o saldo é suavizado por um núcleo gaussiano de 0,25° (cerca de 28 km), para que cada pico tenha encosta.
  // Cada faixa só é desenhada sobre o território (ou onde há saldo junto à costa).
  const ridgeRows = useMemo(() => {
    if (!savings || !states) return null;
    const polys = states.features.flatMap(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
      .map(rings => { const xs = rings[0].map(c => c[0]), ys = rings[0].map(c => c[1]); return { rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; });
    const inside = (x, y) => polys.some(({ rings, box }) => {
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return false;
      let hit = false;
      for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    });
    const bands = new Map();
    for (const [a, b, v] of savings.cells) { const r = Math.floor(a / 2); if (!bands.has(r)) bands.set(r, new Map()); const row = bands.get(r); row.set(b, (row.get(b) || 0) + v); }
    const r0 = Math.min(...bands.keys()), r1 = Math.max(...bands.keys()), lonStep = savings.lonStep, latStep = savings.latStep * 2;
    const b0 = Math.floor(-74 / lonStep), b1 = Math.ceil(-34 / lonStep);
    const kernel = [-3, -2, -1, 0, 1, 2, 3].map(k => [k, Math.exp(-k * k / 2)]), ksum = kernel.reduce((t, [, w]) => t + w, 0);
    const rows = []; let max = 0;
    for (let r = r1; r >= r0; r--) {
      const raw = bands.get(r) || new Map(), lat = (r + .5) * latStep, samples = [];
      for (let b = b0; b <= b1; b++) samples.push([(b + .5) * lonStep, kernel.reduce((t, [k, w]) => t + w * (raw.get(b + k) || 0), 0) / ksum, inside((b + .5) * lonStep, lat)]);
      samples.forEach(([, v]) => { max = Math.max(max, v); });
      rows.push({ lat, samples });
    }
    // Trechos contínuos sobre terra (ou com saldo), com uma amostra de folga em cada ponta.
    const runs = [];
    for (const { lat, samples } of rows) {
      const keep = samples.map(([, v, land]) => land || v > max * .004);
      let start = -1;
      keep.forEach((k, i) => {
        if (k && start < 0) start = i;
        if ((!k || i === keep.length - 1) && start >= 0) { const end = k ? i : i - 1; if (end - start >= 1) runs.push({ lat, pts: samples.slice(Math.max(0, start - 1), Math.min(samples.length, end + 2)).map(([lon, v]) => [lon, v]) }); start = -1; }
      });
    }
    return { max, runs };
  }, [savings, states]);

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
      m = new maplibregl.Map({ container: host.current, style: baseStyle(states, municipalities), center: [-26, -24], zoom: 2.9, minZoom: 1.8, maxZoom: 18, dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false, attributionControl: false, fadeDuration: 0 });
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
      // Se a pessoa já foi para a exploração antes de o mapa ficar pronto, aplica a exploração no lugar do filme.
      if (modeRef.current === 'explore') { lastData.current.look = null; applyLook(EXPLORE); cancelAnim(); const b = m.cameraForBounds(BR_BOUNDS, { padding: PAD }); if (b) m.jumpTo({ center: b.center, zoom: b.zoom }); updateView(); }
      else { clock.current.playing = true; clock.current.last = 0; setPlaying(true); }
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
    // Sem área útil (aba oculta ou margem maior que o mapa) o MapLibre não devolve câmera; mantém a anterior.
    if (!c) return;
    const w = m.getCanvas().clientWidth, h = m.getCanvas().clientHeight, k = Math.log2(Math.min(w, h * 1.25) / 1000);
    const top = places.find(pl => pl.ibge === pix.facts.highest.ibge);
    const brasil = { center: [c.center.lng, c.center.lat], zoom: c.zoom };
    cams.current = { sea: { center: [-24, -26], zoom: brasil.zoom - .2 }, brasil, perto: { center: brasil.center, zoom: brasil.zoom + .25 }, fronteira: { center: top ? (top.visit || [top.lon, top.lat]) : brasil.center, zoom: 7.3 + k }, campo: { center: [brasil.center[0] - 2.5, brasil.center[1] - 1.5], zoom: brasil.zoom + .35 } };
  }
  function cameraAt(i, p) {
    const C = cams.current, w = map.current.getCanvas().clientWidth;
    const legs = { abertura: [C.sea, C.brasil, 0, 1], rede: [C.brasil, C.perto, 0, 1], pix: [C.perto, C.brasil, 0, .3], fronteira: [C.brasil, C.fronteira, 0, .55],
      inad: [C.fronteira, C.brasil, 0, .3], renda: [C.brasil, C.brasil, 0, 1], poupanca: [C.brasil, C.brasil, 0, 1], rural: [C.brasil, C.campo, 0, .4] }[CHAPTERS[i].id];
    const u = smooth(clamp((p - legs[2]) / (legs[3] - legs[2])));
    return fromView(interpolateZoom(toView(legs[0], w), toView(legs[1], w))(u), w);
  }
  // Opacidade das camadas por capítulo, com as passagens no início de cada um.
  function lookAt(i, p) {
    const fadeIn = (a = .12) => clamp(p / a);
    const L = { chart: 0, veil: 0, uf: 0, pts: 0, pix: 0, rural: 0, ridge: 0 }, id = CHAPTERS[i].id;
    if (id === 'rede') L.pts = 1;
    if (id === 'pix') { L.pts = 1 - fadeIn(.15); L.pix = fadeIn(.15) * .85; }
    if (id === 'fronteira') { L.pix = .85; L.pts = clamp((p - .55) / .2) * .8; }
    if (id === 'inad') { L.pix = .85 * (1 - fadeIn(.2)); L.pts = .8 * (1 - fadeIn(.2)); L.uf = .6 * clamp((p - .06) / .1); L.chart = clamp((p - .16) / .03); L.veil = VEIL * smooth(clamp((p - .22) / .16)); }
    if (id === 'renda') { L.uf = .6; L.chart = 1; L.veil = VEIL; }
    if (id === 'poupanca') { L.uf = .6 * (1 - fadeIn(.15)); L.chart = 1 - clamp((p - .12) / .05); L.veil = VEIL * (1 - smooth(clamp(p / .15))); L.ridge = clamp((p - .3) / .1); }
    if (id === 'rural') { L.ridge = 1 - fadeIn(.1); L.rural = clamp((p - .08) / .1); }
    return L;
  }
  function applyLook(L) {
    const m = map.current; if (!m?.getLayer('pts-exact')) return;
    const pts = instRef.current != null ? .12 : L.pts;
    const key = [L.chart, L.veil, L.uf, pts, L.pix, L.rural, L.ridge].map(v => v.toFixed(3)).join(); if (key === lastData.current.look) return; lastData.current.look = key;
    if (chart.current) { chart.current.style.opacity = L.chart; chart.current.style.visibility = L.chart > .01 ? 'visible' : 'hidden'; }
    if (veil.current) veil.current.style.opacity = L.veil;
    if (ridges.current) { ridges.current.style.opacity = L.ridge; ridges.current.style.visibility = L.ridge > .01 ? 'visible' : 'hidden'; }
    m.setPaintProperty('uf-fill', 'fill-opacity', L.uf);
    m.setPaintProperty('muni-pix', 'fill-opacity', L.pix);
    m.setPaintProperty('pts-exact', 'circle-opacity', pts);
    m.setPaintProperty('pts-exact', 'circle-stroke-opacity', pts);
    m.setPaintProperty('pts-loose', 'circle-opacity', ['interpolate', ['linear'], ['zoom'], 10.5, pts, 12.5, pts * .18]);
    m.setPaintProperty('rural', 'circle-opacity', L.rural * .62);
    m.setPaintProperty('rural', 'circle-stroke-opacity', L.rural * .9);
  }
  const EXPLORE = { chart: 0, veil: 0, uf: 0, pts: 1, pix: 0, rural: 0, ridge: 0 };

  // Relevo da poupança: linhas desenhadas sobre o mapa, projetadas a cada quadro do capítulo.
  function drawRidges(grow) {
    const svg = ridges.current, m = map.current; if (!svg || !m || !ridgeRows) return;
    if (svg.dataset.n !== String(ridgeRows.runs.length)) {
      svg.textContent = ''; svg.dataset.n = ridgeRows.runs.length;
      for (const run of ridgeRows.runs) { run.fill = document.createElementNS('http://www.w3.org/2000/svg', 'path'); run.fill.setAttribute('class', 'ridge-fill'); run.line = document.createElementNS('http://www.w3.org/2000/svg', 'path'); run.line.setAttribute('class', 'ridge-line'); svg.append(run.fill, run.line); }
    }
    const h = Math.min(150, m.getCanvas().clientHeight * .2);
    for (const run of ridgeRows.runs) {
      let d = '', x0 = 0, x1 = 0, yb = 0;
      run.pts.forEach(([lon, v], j) => { const q = m.project([lon, run.lat]); const y = q.y - h * Math.sqrt(v / ridgeRows.max) * grow; d += (j ? 'L' : 'M') + q.x.toFixed(1) + ' ' + y.toFixed(1); if (!j) x0 = q.x; x1 = q.x; yb = q.y; });
      run.line.setAttribute('d', d); run.fill.setAttribute('d', `${d}L${x1.toFixed(1)} ${yb.toFixed(1)}L${x0.toFixed(1)} ${yb.toFixed(1)}Z`);
    }
  }

  // Gráfico da inadimplência, redesenhado a cada quadro. Contornos próximos se afastam só na horizontal;
  // a altura de cada um segue a taxa. Posições amortecidas entre quadros para que nada salte.
  function drawChart(id, p, dt) {
    const svg = chart.current, m = map.current, S = chartRef.current; if (!svg || !m || !S) return;
    const st = chartState(S, id, p), W = m.getCanvas().clientWidth, Hs = m.getCanvas().clientHeight, narrow = W < 760;
    const F = { l: narrow ? 44 : 96, r: W - (narrow ? 58 : 110), t: narrow ? 70 : 72, b: Hs - (narrow ? 44 : 56) };
    const morph = id === 'inad' ? smooth(clamp((p - .16) / .06)) : 1;
    const travel = id === 'inad' ? easeInOut(clamp((p - .22) / .16)) : id === 'poupanca' ? 1 - easeInOut(clamp(p / .15)) : 1;
    // Eixo e alturas amortecidos (constante de ~110 ms); um salto de capítulo se resolve em poucos quadros.
    const k = 1 - Math.exp(-(dt || 16) / 110);
    const Y = chartY.current && chartY.current.rates.length === st.rates.length ? chartY.current : (chartY.current = { yMax: st.yMax, rates: st.rates.slice(), national: st.national });
    Y.yMax += (st.yMax - Y.yMax) * k; Y.national = Y.national == null ? st.national : Y.national + ((st.national ?? Y.national) - Y.national) * k;
    st.rates.forEach((v, j) => { Y.rates[j] = v == null ? null : Y.rates[j] == null ? v : Y.rates[j] + (v - Y.rates[j]) * k; });
    const y = v => F.b - (F.b - F.t) * clamp(v / Y.yMax, 0, 1.04);
    const ax = S.shapes.map(sh => sh ? F.l + 14 + (sh.center[0] - S.lon0) / (S.lon1 - S.lon0) * (F.r - F.l - 28) : 0);
    const ys = Y.rates.map(v => v == null ? null : y(v));
    const X = chartX.current && chartX.current.length === ax.length ? chartX.current : (chartX.current = ax.slice());
    const D = narrow ? 18 : 23;
    for (let it = 0; it < 3; it++) {
      X.forEach((x, j) => { X[j] = x + (ax[j] - x) * .06; });
      for (let a = 0; a < X.length; a++) for (let b = a + 1; b < X.length; b++) {
        if (ys[a] == null || ys[b] == null) continue;
        const dy = Math.abs(ys[a] - ys[b]); if (dy >= D) continue;
        const need = Math.sqrt(D * D - dy * dy), dx = X[b] - X[a]; if (Math.abs(dx) >= need) continue;
        const dir = dx > 0 || (dx === 0 && ax[b] >= ax[a]) ? 1 : -1, push = (need - Math.abs(dx)) * .25;
        X[a] -= push * dir; X[b] += push * dir;
      }
      X.forEach((x, j) => { X[j] = clamp(x, F.l + 8, F.r - 8); });
    }
    const N = chartNodes(svg, S), fx = v => v.toFixed(1), out = [];
    N.axis.setAttribute('opacity', travel.toFixed(3)); N.axis.style.display = travel > .01 ? '' : 'none';
    if (travel > .01) {
      // Grade em 1, 5 e 10 pontos; cada nível aparece quando há espaço entre as linhas.
      const per = (F.b - F.t) / Y.yMax;
      for (let v = 0; v <= Math.floor(Y.yMax + .001); v++) {
        const a = v === 0 || v % 10 === 0 ? 1 : v % 5 === 0 ? clamp((per * 5 - 26) / 24) : clamp((per - 26) / 16);
        if (a <= .01) continue;
        out.push(`<g opacity="${a.toFixed(2)}"><line x1="${fx(F.l)}" x2="${fx(F.r)}" y1="${fx(y(v))}" y2="${fx(y(v))}" class="${v ? 'chart-grid' : 'chart-base'}"/><text x="${fx(F.l - 12)}" y="${fx(y(v) + 4)}" text-anchor="end" class="chart-tick">${v}%</text></g>`);
      }
      out.push(`<text x="${fx(F.l)}" y="${fx(F.b + 24)}" class="chart-tick">oeste</text><text x="${fx(F.r)}" y="${fx(F.b + 24)}" text-anchor="end" class="chart-tick">leste</text>`);
      const legend = narrow ? [[1, 2, 5], [3, 4]] : [[1, 2, 5, 3, 4]];
      legend.forEach((line, n) => out.push(`<text x="${fx(narrow ? 14 : F.l)}" y="${fx(F.t - (narrow ? 38 : 26) + n * 17)}" class="chart-legend">${line.map((r, i) => `<tspan ${i ? 'dx="18"' : ''} fill="${REGION[r][1]}">● ${REGION[r][0]}</tspan>`).join('')}</text>`));
      if (Y.national != null) out.push(`<line x1="${fx(F.l)}" x2="${fx(F.r)}" y1="${fx(y(Y.national))}" y2="${fx(y(Y.national))}" class="chart-national"/><text x="${fx(F.r + 10)}" y="${fx(y(Y.national) - 3)}" class="chart-national-label">Brasil</text><text x="${fx(F.r + 10)}" y="${fx(y(Y.national) + 13)}" class="chart-national-label">${percent(st.national)}</text>`);
      N.axis.innerHTML = out.join('');
    }
    let hi = -1, lo = -1; st.rates.forEach((v, j) => { if (v == null || !S.shapes[j]) return; if (hi < 0 || v > st.rates[hi]) hi = j; if (lo < 0 || v < st.rates[lo]) lo = j; });
    const stem = smooth(clamp((travel - .75) / .25)), shown = [];
    S.shapes.forEach((sh, j) => {
      const it = N.items[j]; if (!it) return;
      const on = ys[j] != null; it.g.style.display = on ? '' : 'none'; if (!on) return;
      const q = m.project(sh.center), x = lerp(q.x, X[j], travel), yy = lerp(q.y, ys[j], travel);
      it.stem.setAttribute('x1', fx(x)); it.stem.setAttribute('x2', fx(x)); it.stem.setAttribute('y1', fx(F.b)); it.stem.setAttribute('y2', fx(yy)); it.stem.setAttribute('opacity', (stem * .55).toFixed(3));
      it.dot.setAttribute('cx', fx(x)); it.dot.setAttribute('cy', fx(yy)); it.dot.setAttribute('r', (3.4 * (1 - morph)).toFixed(2));
      it.shape.setAttribute('transform', `translate(${fx(x)} ${fx(yy)}) scale(${(morph * (narrow ? .78 : 1)).toFixed(3)}) translate(${fx(-sh.cx)} ${fx(-sh.cy)})`);
      if (travel > .97 && (j === hi || j === lo)) shown.push([j, x, yy]);
    });
    N.labels.forEach((t, k) => {
      const hit = shown[k]; t.style.display = hit ? '' : 'none'; if (!hit) return;
      const [j, x, yy] = hit, end = x > F.r - 170;
      t.setAttribute('x', fx(end ? x - 17 : x + 17)); t.setAttribute('y', fx(yy + 4)); t.setAttribute('text-anchor', end ? 'end' : 'start');
      const html = `${S.shapes[j].name} <tspan>${percent(st.rates[j])}</tspan>`; if (t.dataset.html !== html) { t.innerHTML = html; t.dataset.html = html; }
    });
  }
  // Elementos do gráfico criados uma vez por base; cada quadro só move atributos.
  function chartNodes(svg, S) {
    if (chartDom.current?.S === S && chartDom.current.svg === svg) return chartDom.current;
    const el = (tag, cls, parent) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); if (cls) e.setAttribute('class', cls); parent.appendChild(e); return e; };
    svg.textContent = '';
    const axis = el('g', 'chart-axis', svg), body = el('g', '', svg), top = el('g', '', svg);
    const items = S.shapes.map(sh => { if (!sh) return null; const g = el('g', '', body), stem = el('line', 'chart-stem', g), dot = el('circle', 'chart-dot', g), shape = el('path', 'chart-shape', g); shape.setAttribute('d', sh.d); for (const e of [dot, shape]) e.style.fill = sh.color; stem.style.stroke = sh.color; return { g, stem, dot, shape }; });
    return chartDom.current = { S, svg, axis, items, labels: [el('text', 'chart-label', top), el('text', 'chart-label', top)] };
  }

  // Relógio do filme: câmera em todo quadro; a interface se atualiza a ~15 quadros por segundo.
  useEffect(() => {
    if (!ready) return;
    const tick = now => {
      const c = clock.current, dt = c.last ? Math.min(100, now - c.last) : 16;
      if (c.playing && modeRef.current === 'film') {
        c.t = Math.min(TOTAL, c.t + (c.last ? Math.min(400, now - c.last) : 0));
        if (c.t >= TOTAL) { c.playing = false; setPlaying(false); converge(true); }
      }
      c.last = now;
      if (modeRef.current === 'film') {
        const { i, p } = chapterAt(c.t), id = CHAPTERS[i].id;
        map.current.jumpTo(cameraAt(i, p)); const L = lookAt(i, p); applyLook(L);
        if (L.ridge > .01) drawRidges(id === 'poupanca' ? smooth(clamp((p - .3) / .5)) : 1);
        if (L.chart > .01) drawChart(id, p, dt);
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
    if (recenter) setTimeout(() => { const m = map.current; if (!m) return; const c = m.cameraForBounds(BR_BOUNDS, { padding: PAD }); if (c) flyTo({ center: [c.center.lng, c.center.lat], zoom: c.zoom }, true); }, 720);
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
  const scope = segment < 0 ? (person === 'PF' ? 'Todas as faixas' : 'Todas as empresas') : ds.segments[segment];
  const viewIdx = mode === 'explore' ? ufIndex(view?.uf) : -1;
  const muni = view?.muni ? placeByCode.get(view.muni) : null;
  const sel = selected != null ? rows[selected] : null, selD = selected != null && details ? details[selected] : null, selInst = sel ? meta.institutions[sel[3]] : null;
  const top = placeByCode.get(pix.facts.highest.ibge), pixLast = pix.months.length - 1;
  const pixPct = v => v == null ? 'N/D' : nf(v / 10, 1).replace(',0', '') + '%';
  const muniPix = muni ? pix.municipalities[muni.ibge] : null;
  const rk = Math.round(ruralMonth);
  const chartNow = mode === 'film' && (chapter === AT.inad || chapter === AT.renda) && chartRef.current ? chartState(chartRef.current, CHAPTERS[chapter].id, p) : null;
  const networkNames = [...NETWORK_ORDER.map(k => meta.institutions.find(x => x.cnpjBase === k)), { name: 'Cooperativas', color: KIND_COLOR.cooperativa }, { name: 'Demais instituições', color: KIND_COLOR.agencia }];
  const regionLine = x => { const r = x?.analysisCode && regions.institutions[x.analysisCode]; if (!r || !r['Total Geral']) return null; return REGIONS.map(([k, label]) => [label, (r[k] || 0) / r['Total Geral']]).filter(([, v]) => v >= .005).sort((a, b) => b[1] - a[1]).map(([label, v]) => `${label} ${nf(v * 100, 0)}%`).join(' · '); };
  const personSwitch = <div className="atlas-person-switch" role="group" aria-label="Tipo de cliente"><button aria-pressed={person === 'PF'} onClick={() => setPerson('PF')}>Pessoas físicas</button><button aria-pressed={person === 'PJ'} onClick={() => setPerson('PJ')}>Pessoas jurídicas</button></div>;
  const ticks = <div className="atlas-segment-ticks">{[-1, ...bands].map(i => <button key={i} aria-pressed={segment === i} aria-label={i < 0 ? 'Todas' : ds.segments[i]} onClick={() => { setManualSegment(i); if (clock.current.playing) { clock.current.playing = false; setPlaying(false); } }}>{i < 0 ? 'Todas' : compactSegment(ds.segments[i], ds.segmentKind)}</button>)}</div>;

  // Legenda de cada capítulo, sobre o mapa: leitura, no máximo uma frase e a fonte.
  const caption = [
    // No celular o subtítulo some do cabeçalho; a abertura o traz de volta na legenda.
    <><h2 className="narrow-only">Atlas do dinheiro e patrimônio no território brasileiro</h2><p className="src narrow-only">Dados públicos do Banco Central e do IBGE.</p></>,
    <><h2>Agências</h2><p className="network-now">{networkStep >= 0 && <><i style={{ background: networkNames[networkStep].color }} />{networkNames[networkStep].name} <span>{nf(networkCounts[networkStep])} unidades</span></>}</p>
      <p className="src">{nf(c.kinds.agencia)} agências e {nf(c.units - c.kinds.agencia)} postos no endereço cadastrado. BCB, 05/11/2026; CNEFE 2022 (IBGE).</p></>,
    <><h2>Pix</h2><div className="atlas-reading"><strong>{pixPct(pix.national[pixMonth])}</strong><span>da população pagou em {ym(pix.months[pixMonth])}</span></div>
      <div className="atlas-rate-legend">{PIX_STOPS.map(([v, col], i) => <span key={v}><i style={{ background: col }} />{v / 10}{i === PIX_STOPS.length - 1 ? '%+' : ''}</span>)}</div>
      <p className="src">Pessoas físicas pagadoras sobre a população, por município. BCB, dados abertos; IBGE, estimativa 2025.</p></>,
    <><h2>{top ? top.name : 'Fronteira'}</h2><p className="note">{pix.facts.highest.ibge === '1400456' ? 'Na fronteira com a Venezuela, ' : ''}{nf(pix.facts.highest.payers)} pessoas pagaram com Pix em {ym(pix.months[pixLast])}. A população estimada é de {nf(pix.facts.highest.population)}.</p>
      <p className="src">O BCB não publica como atribui o município ao pagador.</p></>,
    <><h2>Inadimplência</h2><div className="atlas-reading"><strong>{percent(chartNow?.national)}</strong><span>{siteMonth(ds.months[inadMonth])}</span></div>
      <p className="src">{person === 'PF' ? 'Pessoas físicas' : 'Pessoas jurídicas'}, por UF do tomador. Cada contorno fica na longitude do centro da sua UF e na altura da sua taxa; cor pela região. BCB, SCR.data.</p></>,
    <><h2>{person === 'PF' ? 'Por renda' : 'Por porte'}</h2><div className="atlas-reading"><strong>{percent(chartNow?.national)}</strong><span>{scope}</span></div>
      <p className="src">O eixo acompanha cada faixa; a linha do Brasil é a referência. BCB, SCR.data, {siteMonth(ds.months[latest])}.</p></>,
    <><h2>Poupança</h2><div className="atlas-reading"><strong>R$ {nf(savings.totalBi, 0)} bi</strong><span>em {nf(savings.agencies)} agências, jun/2026</span></div>
      <p className="src">Saldo das agências somado em faixas de 0,8° de latitude e suavizado em cerca de 28 km; altura pela raiz do saldo. BCB, ESTBAN; sem cooperativas.</p></>,
    <><h2>Crédito rural</h2><div className="atlas-reading"><strong>R$ {nf(rural.totalBi[rk], 1)} bi</strong><span>contratados em {ym(rural.months[rk])}</span></div>
      <p className="src">Pelo município do empreendimento. BCB, SICOR; {nf(rural.coverage.operations * 100, 0)}% das operações e {nf(rural.coverage.value * 100, 0)}% do valor de 2025 trazem município.</p></>,
  ];

  return <main className={'territory atlas-landing mode-' + mode}>
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
            <h3>Inadimplência</h3>
            {personSwitch}
            <div className="atlas-reading small"><strong>{percent(rate(cube.get(latest, segment, -1, viewIdx)))}</strong><span>{siteMonth(ds.months[latest])}</span>{viewIdx >= 0 && <small>Brasil: {percent(rate(cube.get(latest, segment, -1)))}</small>}</div>
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
        <svg className="chart" ref={chart} aria-hidden="true" />
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
