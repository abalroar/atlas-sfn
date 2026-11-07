// Câmera contínua: interpolação de zoom e deslocamento de van Wijk e Nuij (2003),
// a mesma família de curva usada por d3.interpolateZoom e pelo flyTo do MapLibre.
// A posição da câmera é função pura de t ∈ [0,1], portanto pode seguir a rolagem.
const TILE = 512, RHO = Math.SQRT2, RHO2 = 2, RHO4 = 4;

export function project([lon, lat]) {
  const s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}
export function unproject([x, y]) {
  const n = Math.PI - 2 * Math.PI * y;
  return [x * 360 - 180, 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
}
export const toView = (camera, width) => {
  const [x, y] = project(camera.center);
  return [x, y, width / (TILE * 2 ** camera.zoom)];
};
export const fromView = ([x, y, w], width) => ({ center: unproject([x, y]), zoom: Math.log2(width / (TILE * w)) });

export function interpolateZoom(p0, p1) {
  const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1;
  const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  if (d2 < 1e-24) {
    const S = Math.log(w1 / w0) / RHO;
    const f = t => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * S)];
    f.duration = Math.abs(S);
    return f;
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + RHO4 * d2) / (2 * w0 * RHO2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - RHO4 * d2) / (2 * w1 * RHO2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / RHO;
  const f = t => {
    const s = t * S, c0 = Math.cosh(r0);
    const u = w0 / (RHO2 * d1) * (c0 * Math.tanh(RHO * s + r0) - Math.sinh(r0));
    return [ux0 + u * dx, uy0 + u * dy, w0 * c0 / Math.cosh(RHO * s + r0)];
  };
  f.duration = Math.abs(S);
  return f;
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = t => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;
