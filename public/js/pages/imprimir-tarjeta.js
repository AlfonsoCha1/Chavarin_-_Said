import { mountChrome, api, esc, $, errorBlock, cardHtml } from '../app.js';
mountChrome();
const code = decodeURIComponent(location.pathname.split('/').pop());
Promise.all([api(`/api/staff/cards/${encodeURIComponent(code)}`), api('/api/staff/me')]).then(([c, me]) => {
  $('#sheet').innerHTML = `<div style="display:grid;place-items:center">${cardHtml({ company: me.company.name, program: c.card.programName, balance: c.card.balance, kind: c.card.kind, code: c.card.code, color: me.company.cardColor, rewards: c.rewards, qrSrc: `/api/staff/cards/${encodeURIComponent(c.card.code)}/qr.svg` })}</div>
    <p style="margin:16px auto 0;max-width:52ch">Presenta esta tarjeta en el mostrador. El saldo se guarda en el sistema del negocio, no en el papel. Número de tarjeta: <b class="mono">${esc(c.card.code)}</b>.</p>
    <p class="small muted" style="margin:8px auto 0;max-width:52ch">Tarjeta sin contacto registrado: funciona al portador y no se puede reponer si se pierde.</p>`;
}).catch((e) => { $('#sheet').innerHTML = e.status === 401 ? '<p>Entra como personal del negocio para imprimir tarjetas.</p><a class="btn btn-primary" href="/entrar">Entrar</a>' : errorBlock(e); });
$('#print').addEventListener('click', () => print());
