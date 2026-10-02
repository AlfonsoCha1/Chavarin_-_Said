import { mountChrome, api, esc, $, errorBlock, fmtDate, fmtMoney, unit } from '../app.js';
mountChrome();
const code = decodeURIComponent(location.pathname.split('/').pop());
async function load() {
  try {
    const { branch, company, program } = await api(`/api/public/branches/${encodeURIComponent(code)}`);
    document.title = `${company.name}, ${branch.name} — Chavarín & Said`;
    const u = program ? unit(program.kind, 2) : 'puntos';
    $('#view').innerHTML = `
      <p><a href="/n/${esc(company.slug)}">← ${esc(company.name)}</a></p>
      <div class="grid-2">
        <div>
          <h1 style="margin-bottom:6px">${esc(company.name)} — ${esc(branch.name)}</h1>
          <p class="lead">${esc([branch.street, branch.neighborhood].filter(Boolean).join(', '))}, ${esc(branch.city)}${branch.state ? ', ' + esc(branch.state) : ''}${branch.postalCode ? ', C.P. ' + esc(branch.postalCode) : ''}</p>
          <p class="muted">${esc(branch.parentCategory ? branch.parentCategory + ' › ' : '')}${esc(branch.category)}${branch.hours ? ' · ' + esc(branch.hours) : ''}${branch.phone ? ' · Tel. ' + esc(branch.phone) : ''}</p>
          ${company.description ? `<p>${esc(company.description)}</p>` : ''}
          ${program && program.status === 'active' ? `<a class="btn btn-primary btn-big" href="/r/${esc(branch.code)}" style="max-width:360px">Obtener mi tarjeta</a>
            <p class="small muted" style="margin-top:8px">Obtener la tarjeta no suma puntos. Los puntos se suman cuando el personal confirma una compra.</p>` : '<div class="status status-warn"><b>Esta sucursal no tiene un programa activo.</b></div>'}
        </div>
        ${program ? `<div class="panel">
          <h2>${esc(program.name)}</h2>
          <p><b>Cada compra elegible suma ${program.pointsPerPurchase} ${unit(program.kind, program.pointsPerPurchase)}.</b> ${esc(program.eligible)}${program.minPurchaseCents ? ` Compra mínima: ${fmtMoney(program.minPurchaseCents)}.` : ''}</p>
          <h3>Premios</h3>
          <div class="reward-list">${program.rewards.map((r) => `<div class="reward"><span>${esc(r.name)}${r.available ? '' : ' <span class="tag tag-bad">Agotado</span>'}${r.upcomingCost ? `<br><span class="small muted">Desde el ${fmtDate(r.upcomingCost.from)} costará ${r.upcomingCost.cost} ${u}</span>` : ''}</span><span class="cost">${r.cost} ${u}</span></div>`).join('')}</div>
          <h3 style="margin-top:16px">Condiciones</h3>
          <ul class="small">
            <li>${program.expirationDays ? `Los ${u} vencen si pasan ${program.expirationDays} días sin compras registradas.` : `Los ${u} no vencen mientras el programa siga activo.`}</li>
            <li>La tarjeta es ${program.transferable ? 'transferible' : 'personal'}. ${program.transferable ? '' : 'Se recupera con un código a tu celular o correo.'}</li>
            <li>${program.sharedWith.length ? `Tu saldo también vale en: ${program.sharedWith.map((s) => esc(s.name) + ' (' + esc(s.street) + ', ' + esc(s.city) + ')').join('; ')}.` : 'El saldo solo vale en esta sucursal.'}</li>
            <li>${esc(program.terms)}</li>
          </ul>
          ${program.upcoming ? `<div class="status status-warn"><b>Cambio de reglas programado</b><span>Desde el ${fmtDate(program.upcoming.effectiveFrom)}: ${program.upcoming.pointsPerPurchase} por compra. ${esc(program.upcoming.terms)}</span></div>` : ''}
        </div>` : ''}
      </div>`;
  } catch (e) {
    $('#view').innerHTML = e.status === 404
      ? `<div class="panel empty"><p><b>Esta sucursal no está publicada.</b></p><p>Revisa el código QR o busca el negocio en el directorio.</p><a class="btn btn-primary" href="/directorio">Ir al directorio</a></div>`
      : errorBlock(e, 'retry');
    $('#retry')?.addEventListener('click', load);
  }
}
load();
