// Mapa de livro de geografia: tintas hipsométricas, batimetria e sombreamento de relevo nas escalas
// nacional e regional; na escala de rua o relevo se apaga e ficam papel, ruas e pontos.
// Relevo: Terrain Tiles (Mapzen, AWS Open Data, codificação terrarium). Base vetorial: OpenFreeMap (OpenMapTiles).
export const INK = '#16323f', PAPER = '#f3f2ec', SEA = '#a9c9d0';
// Mesma escala fixa de inadimplência do site (web/src/AtlasScene.jsx, ATLAS_RATE_SCALE).
export const RATE_FILL = ['step', ['coalesce', ['feature-state', 'rate'], -1], 'rgba(0,0,0,0)', 0, '#e0ecef', 3, '#c7dfe7', 5, '#9ac4d4', 7, '#6ba5bd', 10, '#47869f', 15, '#2c657f'];
// Adoção do Pix: pessoas físicas pagadoras no mês / população, em milésimos.
export const PIX_STOPS = [[0, '#eef1ea'], [200, '#d3e4e2'], [400, '#a6cdce'], [500, '#6dafb5'], [600, '#3e8e9a'], [700, '#1f6677']];
export const PIX_FILL = ['step', ['coalesce', ['feature-state', 'pix'], -1], 'rgba(0,0,0,0)', ...PIX_STOPS.flat()];
const font = ['Noto Sans Regular'], bold = ['Noto Sans Bold'];
const fade = (from, to, a = 1, b = 0) => ['interpolate', ['linear'], ['zoom'], from, a, to, b];
const road = (id, minzoom, classes, width) => ({
  id, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom,
  filter: ['in', ['get', 'class'], ['literal', classes]], layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], ...width] },
});

export function baseStyle(states, municipalities) {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' },
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 11, attribution: 'Relevo: Terrain Tiles (Mapzen, AWS Open Data)' },
      states: { type: 'geojson', data: states, promoteId: 'uf' },
      municipalities: { type: 'geojson', data: municipalities, tolerance: 0.6, promoteId: 'codarea' },
      oceans: { type: 'geojson', data: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { t: 'Oceano Atlântico' }, geometry: { type: 'Point', coordinates: [-29, -19] } },
        { type: 'Feature', properties: { t: 'Oceano Pacífico' }, geometry: { type: 'Point', coordinates: [-86, -18] } }] } },
    },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': PAPER } },
      { id: 'ocean', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': SEA } },
      { id: 'hypso', type: 'color-relief', source: 'dem', maxzoom: 12, paint: {
        'color-relief-color': ['interpolate', ['linear'], ['elevation'],
          -6000, '#1d4a5c', -4000, '#2d6377', -2000, '#4f8596', -200, '#83b0bb', -20, '#a9ccd3', 0, '#bcd8dc',
          1, '#e1e8d6', 150, '#e7ebd4', 400, '#ece6c9', 800, '#e3d3af', 1400, '#d3b791', 2400, '#ba9a7d', 4000, '#d9d2cc', 6000, '#f4f2ef'],
        'color-relief-opacity': fade(9, 11.5) } },
      { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'retail']]], paint: { 'fill-color': '#ebebe3', 'fill-opacity': fade(11, 13, 0, 0.8) } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', minzoom: 10, paint: { 'fill-color': '#e3eadf' } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', minzoom: 4, filter: ['!=', ['get', 'class'], 'ocean'], paint: { 'fill-color': '#9cc3cc' } },
      { id: 'river', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#86b5c1', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 8, 1.3, 14, 2.4] } },
      { id: 'uf-fill', type: 'fill', source: 'states', paint: { 'fill-color': RATE_FILL, 'fill-opacity': 0 } },
      { id: 'muni-pix', type: 'fill', source: 'municipalities', paint: { 'fill-color': PIX_FILL, 'fill-opacity': 0 } },
      { id: 'shade', type: 'hillshade', source: 'dem', maxzoom: 12, paint: { 'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 3, 0.36, 9, 0.3, 11.5, 0], 'hillshade-shadow-color': '#46524e', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#5b665f' } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#e4e4dc', 'fill-outline-color': '#d8d8cf', 'fill-opacity': fade(14, 15, 0, 1) } },
      road('road-minor', 12, ['minor', 'service'], [12, 0.5, 18, 10]),
      road('road-mid', 8, ['secondary', 'tertiary'], [8, 0.4, 18, 14]),
      road('road-major', 5, ['motorway', 'trunk', 'primary'], [5, 0.4, 10, 1.4, 18, 18]),
      { id: 'muni-line', type: 'line', source: 'municipalities', minzoom: 6, maxzoom: 12, paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 7.5, 0.6, 11, 0.4, 12, 0] } },
      { id: 'state-line', type: 'line', source: 'states', paint: { 'line-color': '#5a6a6c', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 8, 1.1], 'line-dasharray': [3, 1.5], 'line-opacity': fade(10, 12, 0.75, 0.25) } },
      { id: 'country', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': '#2e3d42', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.9, 8, 1.6] } },
      { id: 'muni-hit', type: 'fill', source: 'municipalities', paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
      { id: 'state-hit', type: 'fill', source: 'states', paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
      { id: 'ocean-label', type: 'symbol', source: 'oceans', maxzoom: 6, layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Italic'], 'text-size': 13, 'text-letter-spacing': 0.22, 'text-max-width': 6 }, paint: { 'text-color': '#2f5f70', 'text-opacity': 0.8 } },
      { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 10.5 }, paint: { 'text-color': '#6d7f84', 'text-halo-color': '#fff', 'text-halo-width': 1.2 } },
      { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 8.5, filter: ['in', ['get', 'class'], ['literal', ['town', 'suburb', 'neighbourhood']]],
        layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 14, 12] }, paint: { 'text-color': '#4f6268', 'text-halo-color': 'rgba(255,255,255,.8)', 'text-halo-width': 1.3 } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 4.5, filter: ['==', ['get', 'class'], 'city'],
        layout: { 'text-field': ['get', 'name'], 'text-font': bold, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13], 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.6 },
        paint: { 'text-color': INK, 'text-halo-color': 'rgba(255,255,255,.8)', 'text-halo-width': 1.5, 'text-opacity': fade(4.5, 5.2, 0, 0.9) } },
    ],
  };
}
