// Medidor de quadros para diagnóstico, ligado só com ?fps=1 na URL. Mostra na tela a média e o pior
// quadro do último segundo, os quadros acima de 50 ms desde o carregamento, quando o mapa apareceu e
// como foi a passagem do filme para a exploração.
export function startPerfOverlay() {
  if (typeof location === 'undefined' || new URLSearchParams(location.search).get('fps') !== '1') return;
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99999;background:rgba(22,50,63,.88);color:#fff;font:11px/1.4 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:4px;pointer-events:none;white-space:pre';
  document.body.append(box);
  const frames = [], start = performance.now();
  let last = start, long = 0, revealedAt = null, transition = null, watching = null;
  const loop = now => {
    const dt = now - last; last = now; frames.push([now, dt]);
    if (dt > 50 && now - start > 500) long++;
    while (frames.length && now - frames[0][0] > 1000) frames.shift();
    const main = document.querySelector('main.territory');
    if (main && revealedAt == null && main.classList.contains('is-revealed')) revealedAt = Math.round(now);
    if (main && !watching && !transition && main.classList.contains('mode-explore') && revealedAt != null) watching = {from: now, list: []};
    if (watching) {watching.list.push(dt); if (now - watching.from > 1500) {const l = watching.list.slice(1); transition = {avg: l.reduce((a, b) => a + b, 0) / l.length, worst: Math.max(...l), long: l.filter(v => v > 50).length}; watching = null;}}
    const recent = frames.map(f => f[1]), avg = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
    box.textContent = `fps ${Math.round(1000 / avg)} · pior ${Math.round(Math.max(...recent))} ms\n>50 ms desde o início: ${long}\nmapa visível: ${revealedAt == null ? '—' : (revealedAt / 1000).toFixed(1) + ' s'}\ntransição: ${transition ? `${Math.round(1000 / transition.avg)} fps · pior ${Math.round(transition.worst)} ms · >50 ms: ${transition.long}` : '—'}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
