import { mountChrome, api, esc, $, $$, showStatus, cardHtml, getConfig } from '../app.js';
mountChrome();
const code = decodeURIComponent(location.pathname.split('/').pop());
let branch = null;
let pending = null;

async function loadBranch() {
  try {
    const data = await api(`/api/public/branches/${encodeURIComponent(code)}`);
    branch = data;
    $('#branchInfo').innerHTML = `<p class="muted" style="margin-bottom:4px">Registro en</p><h1 style="font-size:1.7rem;margin-bottom:4px">${esc(data.company.name)}</h1>
      <p>${esc(data.branch.name)} · ${esc(data.branch.street)}, ${esc(data.branch.city)}</p>`;
    if (!data.program || data.program.status !== 'active') {
      $('#branchInfo').insertAdjacentHTML('beforeend', '<div class="status status-warn"><b>Esta sucursal no tiene un programa activo.</b></div>');
      return;
    }
    $('#step1').hidden = false;
  } catch (e) {
    $('#branchInfo').innerHTML = e.status === 404
      ? `<div class="panel empty"><p><b>Este QR no corresponde a una sucursal publicada.</b></p><p>Pide ayuda al personal o busca el negocio en el directorio.</p><a class="btn btn-primary" href="/directorio">Ir al directorio</a></div>`
      : `<div class="status status-err" role="alert"><b>No se pudo cargar la sucursal</b><span>${esc(e.message)}</span></div>`;
  }
}

function syncChannel() {
  const ch = $('input[name="channel"]:checked').value;
  $('#emailField').hidden = ch !== 'email';
  $('#phoneField').hidden = ch === 'email';
}
$$('input[name="channel"]').forEach((r) => r.addEventListener('change', syncChannel));

$('#form1').addEventListener('submit', async (e) => {
  e.preventDefault();
  const channel = $('input[name="channel"]:checked').value;
  const contactType = channel === 'email' ? 'email' : 'phone';
  const body = {
    branchCode: code, name: $('#name').value.trim(), contactType, channel,
    contact: contactType === 'email' ? $('#email').value.trim() : $('#phone').value.trim(),
    acceptPrivacy: $('#acceptPrivacy').checked, marketing: $('#marketing').checked,
  };
  if (!body.name) return showStatus($('#msg1'), 'err', 'Escribe tu nombre.');
  if (!body.contact) return showStatus($('#msg1'), 'err', contactType === 'email' ? 'Escribe tu correo.' : 'Escribe tu celular.');
  if (!body.acceptPrivacy) return showStatus($('#msg1'), 'err', 'Para crear la tarjeta debes aceptar el aviso de privacidad.');
  showStatus($('#msg1'), 'pend', 'Enviando código…');
  try {
    const r = await api('/api/public/register/start', { method: 'POST', body });
    pending = r;
    $('#msg1').innerHTML = '';
    $('#step1').hidden = true;
    $('#step2').hidden = false;
    $('#sentTo').textContent = `Lo enviamos por ${{ sms: 'SMS', whatsapp: 'WhatsApp', email: 'correo' }[r.channel]} a ${r.to}. Vence en 10 minutos.`;
    if (r.simulated) $('#simNote').innerHTML = `<p class="sim"><strong>Simulación:</strong> en esta demo no se envían mensajes reales. Abre el <a href="/buzon-demo" target="_blank">buzón simulado</a> para ver el código.</p>`;
    $('#code').focus();
  } catch (err) {
    showStatus($('#msg1'), 'err', err.message);
  }
});

$('#back').addEventListener('click', () => { $('#step2').hidden = true; $('#step1').hidden = false; });

$('#form2').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = $('#code').value.replace(/\D/g, '');
  if (c.length !== 6) return showStatus($('#msg2'), 'err', 'El código tiene 6 dígitos.');
  showStatus($('#msg2'), 'pend', 'Confirmando…');
  try {
    const r = await api('/api/public/register/verify', { method: 'POST', body: { otpId: pending.otpId, code: c } });
    $('#step2').hidden = true;
    const p = branch.program;
    $('#done').hidden = false;
    $('#done').innerHTML = `<div class="status status-ok" role="status"><b>${r.existed ? 'Ya tenías tarjeta' : 'Tarjeta creada'}</b><span>${esc(r.message)}</span></div>
      <div style="margin:18px 0">${cardHtml({ company: branch.company.name, program: p.name, balance: r.card.balance, kind: p.kind, code: r.card.code, color: branch.company.cardColor, rewards: p.rewards, qrSrc: `/api/customer/cards/${r.card.code}/qr.svg` })}</div>
      <p>En el mostrador muestra este QR o di tu número <b class="mono">${esc(r.card.code)}</b>. El personal confirmará tu compra.</p>
      <a class="btn btn-primary" href="/mis-tarjetas">Ver mis tarjetas</a>`;
  } catch (err) {
    showStatus($('#msg2'), 'err', err.message);
  }
});

syncChannel();
getConfig();
loadBranch();
