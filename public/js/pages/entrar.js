import { mountChrome, api, $, showStatus, getConfig, esc } from '../app.js';
mountChrome();

function go(me) {
  if (me.user.isAdmin && !me.company) return (location.href = '/admin');
  if (me.membership?.role === 'employee') return (location.href = '/empleado');
  return (location.href = '/dueno');
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showStatus($('#msg'), 'pend', 'Entrando…');
  try {
    const r = await api('/api/staff/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
    if (r.mustChangePassword) {
      $('#form').hidden = true;
      $('#pform').hidden = false;
      $('#current').value = $('#password').value;
      $('#next').focus();
      return;
    }
    go(await api('/api/staff/me'));
  } catch (err) {
    showStatus($('#msg'), 'err', err.message);
  }
});

$('#pform').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/staff/password', { method: 'POST', body: { current: $('#current').value, next: $('#next').value } });
    go(await api('/api/staff/me'));
  } catch (err) {
    showStatus($('#pmsg'), 'err', err.message);
  }
});

getConfig().then((cfg) => {
  if (!cfg.demoMode) return;
  const accounts = [
    ['Empleado (Tacos del Centro, Sucursal Centro)', 'empleado.centro@example.com'],
    ['Empleada (Tacos del Centro, Sucursal Norte)', 'empleado.norte@example.com'],
    ['Encargada (Tacos del Centro)', 'encargada.tacos@example.com'],
    ['Dueño (Tacos del Centro)', 'dueno.tacos@example.com'],
    ['Empleado (Café Aurora, pide código al canjear)', 'barista.cafe@example.com'],
    ['Dueño (Música Allegro)', 'dueno.allegro@example.com'],
    ['Administración de la plataforma', 'admin@example.com'],
  ];
  $('#demo').innerHTML = `<div class="sim" style="margin-top:18px"><strong>Cuentas de demostración.</strong> Contraseña de todas: <span class="mono">demo-12345</span>
    <div style="display:grid;gap:6px;margin-top:10px">${accounts.map(([l, m]) => `<button class="btn btn-secondary btn-sm" type="button" data-mail="${esc(m)}" style="justify-content:space-between"><span>${esc(l)}</span><span class="mono small">${esc(m)}</span></button>`).join('')}</div></div>`;
  $('#demo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mail]');
    if (!b) return;
    $('#email').value = b.dataset.mail;
    $('#password').value = 'demo-12345';
    $('#form').requestSubmit();
  });
});

api('/api/staff/me').then(go).catch(() => {});
