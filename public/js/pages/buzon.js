import { mountChrome, api, esc, $, fmtDateTime, errorBlock, loadingRows } from '../app.js';
mountChrome();
async function load() {
  $('#list').innerHTML = loadingRows(3);
  try {
    const { messages } = await api('/api/demo/outbox');
    $('#list').innerHTML = messages.length
      ? messages.map((m) => `<article class="panel" style="margin-bottom:10px"><div class="row between"><b>${esc({ sms: 'SMS', whatsapp: 'WhatsApp', email: 'Correo' }[m.channel] ?? m.channel)} a ${esc(m.destination)}</b><span class="small muted">${fmtDateTime(m.created_at)}</span></div>
        <p style="margin:8px 0 0">${esc(m.body).replace(/(\d{6})/, '<b class="mono" style="font-size:1.2rem">$1</b>')}</p></article>`).join('')
      : '<div class="panel empty"><p>No hay mensajes todavía.</p></div>';
  } catch (e) {
    $('#list').innerHTML = e.status === 404 ? '<div class="panel empty"><p>El buzón solo existe en modo demostración.</p></div>' : errorBlock(e);
  }
}
$('#reload').addEventListener('click', load);
load();
