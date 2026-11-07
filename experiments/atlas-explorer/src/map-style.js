// Mapa de base vetorial (OpenFreeMap, esquema OpenMapTiles) com a paleta do Atlas.
// Vetores mudam de nível de zoom sem troca de imagem, o que mantém a aproximação contínua.
export const INK = '#203f50', PAPER = '#eaefed', LAND = '#f8faf8', WATER = '#d3e1e4';
// Mesma escala fixa de inadimplência do site (web/src/AtlasScene.jsx, ATLAS_RATE_SCALE).
export const RATE_FILL = ['step', ['coalesce', ['feature-state', 'rate'], -1], '#e1e7e8', 0, '#e0ecef', 3, '#c7dfe7', 5, '#9ac4d4', 7, '#6ba5bd', 10, '#47869f', 15, '#2c657f'];
const font = ['Noto Sans Regular'], bold = ['Noto Sans Bold'];
const road = (minzoom, classes, width, color = '#ffffff') => ({
  type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom,
  filter: ['in', ['get', 'class'], ['literal', classes]],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], ...width] },
});

export function baseStyle(states, municipalities) {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · IBGE' },
      states: { type: 'geojson', data: states, promoteId: 'uf' },
      municipalities: { type: 'geojson', data: municipalities, tolerance: 0.6 },
    },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': PAPER } },
      { id: 'brasil', type: 'fill', source: 'states', paint: { 'fill-color': LAND } },
      { id: 'uf-fill', type: 'fill', source: 'states', paint: { 'fill-color': RATE_FILL, 'fill-opacity': 1 } },
      { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'retail']]],
        paint: { 'fill-color': '#eef1ee', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.8] } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', minzoom: 9, paint: { 'fill-color': '#e4ede6' } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': WATER } },
      { id: 'river', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 7, paint: { 'line-color': WATER, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 14, 2.5] } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-color': '#e6eae8', 'fill-outline-color': '#d9dfdd', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1] } },
      { ...road(12, ['minor', 'service'], [12, 0.5, 18, 10], '#ffffff'), id: 'road-minor' },
      { ...road(8, ['secondary', 'tertiary'], [8, 0.4, 18, 14], '#ffffff'), id: 'road-mid' },
      { ...road(5, ['motorway', 'trunk', 'primary'], [5, 0.4, 10, 1.4, 18, 18], '#ffffff'), id: 'road-major' },
      { id: 'muni-line', type: 'line', source: 'municipalities', minzoom: 6, maxzoom: 12,
        paint: { 'line-color': '#b8c9c8', 'line-width': 0.5, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 7.5, 0.7, 11, 0.5, 12, 0] } },
      { id: 'state-line', type: 'line', source: 'states',
        paint: { 'line-color': '#9fb4b6', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.1], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 12, 0.25] } },
      { id: 'muni-hit', type: 'fill', source: 'municipalities', paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
      { id: 'state-hit', type: 'fill', source: 'states', paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
      { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 10.5 },
        paint: { 'text-color': '#71858c', 'text-halo-color': '#fff', 'text-halo-width': 1.2 } },
      { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 8.5,
        filter: ['in', ['get', 'class'], ['literal', ['town', 'suburb', 'neighbourhood']]],
        layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 14, 12] },
        paint: { 'text-color': '#61777f', 'text-halo-color': LAND, 'text-halo-width': 1.4 } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 4.5,
        filter: ['==', ['get', 'class'], 'city'],
        layout: { 'text-field': ['get', 'name'], 'text-font': bold, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13], 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.6 },
        paint: { 'text-color': INK, 'text-halo-color': LAND, 'text-halo-width': 1.6, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0, 5.2, 0.9] } },
    ],
  };
}
