import { mountChrome, api, esc, $, errorBlock } from '../app.js';
mountChrome();
const TAG = { implementado: ['Implementado', 'tag-ok'], parcial: ['Parcial', 'tag-pend'], simulado: ['Simulado', 'tag-sim'], procedimiento: ['Procedimiento', 'tag'], pendiente: ['Pendiente', 'tag-pend'] };
let all = [];
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function render() {
  const q = fold($('#q').value.trim());
  const st = $('#st').value;
  const list = all.filter((c) => (!st || c.estado === st) && (!q || fold(Object.values(c).join(' ')).includes(q)));
  $('#count').textContent = `${list.length} de ${all.length} situaciones`;
  $('#list').innerHTML = list.length ? list.map((c) => `
    <article class="case" id="caso-${c.id}">
      <header><h3><span class="num">${String(c.id).padStart(2, '0')}</span>${esc(c.titulo)}</h3><span class="tag ${TAG[c.estado][1]}">${TAG[c.estado][0]}</span></header>
      <dl>
        <dt>Situación</dt><dd>${esc(c.situacion)}</dd>
        <dt>Pantalla</dt><dd>${esc(c.pantalla)}</dd>
        <dt>Respuesta</dt><dd>${esc(c.respuesta)}</dd>
        <dt>Responsable</dt><dd>${esc(c.responsable)}</dd>
        <dt>Prevención</dt><dd>${esc(c.prevencion)}</dd>
        <dt>Estado</dt><dd>${esc(c.estado_detalle)}${c.prueba ? ` <span class="small muted">Prueba: ${esc(c.prueba)}</span>` : ''}</dd>
      </dl></article>`).join('') : '<div class="panel empty"><p>No hay situaciones con ese filtro.</p></div>';
}
api('/data/situaciones.json').then((d) => { all = d.situaciones; render(); }).catch((e) => { $('#list').innerHTML = errorBlock(e); });
$('#q').addEventListener('input', render);
$('#st').addEventListener('change', render);
$('#f').addEventListener('submit', (e) => e.preventDefault());
