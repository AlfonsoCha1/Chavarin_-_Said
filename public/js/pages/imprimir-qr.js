import { mountChrome, api, esc, $, errorBlock } from '../app.js';
mountChrome();
const code = decodeURIComponent(location.pathname.split('/').pop());
api(`/api/public/branches/${encodeURIComponent(code)}`).then(({ branch, company, program }) => {
  $('#sheet').innerHTML = `<h1 style="font-size:2rem;margin-bottom:4px">${esc(company.name)}</h1>
    <p class="lead" style="margin:0 auto">${esc(branch.name)} · ${esc(branch.street)}, ${esc(branch.city)}</p>
    <img class="qr" src="/api/public/branches/${esc(branch.code)}/qr.svg" alt="QR para registrarse en ${esc(company.name)}, ${esc(branch.name)}">
    <h2>Escanea para obtener tu tarjeta</h2>
    <p style="margin:0 auto">${program ? `${esc(program.name)}: cada compra elegible suma ${program.pointsPerPurchase} ${program.kind === 'stamps' ? 'sellos' : 'puntos'}.` : ''}</p>
    <p class="small muted" style="margin:10px auto 0">Escanear este código abre el registro. Los puntos se suman cuando el personal confirma tu compra.</p>`;
}).catch((e) => { $('#sheet').innerHTML = errorBlock(e); });
$('#print').addEventListener('click', () => print());
