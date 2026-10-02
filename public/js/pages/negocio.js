import { mountChrome, api, esc, $, errorBlock } from '../app.js';
mountChrome();
const slug = decodeURIComponent(location.pathname.split('/').pop());
async function load() {
  try {
    const { company, branches, programs } = await api(`/api/public/companies/${encodeURIComponent(slug)}`);
    document.title = `${company.name} — Chavarín & Said`;
    $('#view').innerHTML = `
      <p><a href="/directorio">← Directorio</a></p>
      <div class="row" style="align-items:flex-start;gap:16px">
        ${company.logoUrl ? `<img src="${esc(company.logoUrl)}" alt="" width="64" height="64" style="border-radius:12px">` : `<span style="width:56px;height:56px;border-radius:12px;background:${esc(company.cardColor)}" aria-hidden="true"></span>`}
        <div><h1 style="margin-bottom:6px">${esc(company.name)}</h1><p class="lead" style="margin:0">${esc(company.description ?? '')}</p></div>
      </div>
      <h2 style="margin-top:28px">Sucursales y direcciones</h2>
      <div class="results">${branches.map((b) => `
        <article class="result" style="--card:${esc(company.cardColor)}"><span class="swatch" aria-hidden="true"></span>
          <div><h3>${esc(b.name)}</h3><div class="addr">${esc([b.street, b.neighborhood].filter(Boolean).join(', '))}, ${esc(b.city)}${b.state ? ', ' + esc(b.state) : ''}</div>
          <div class="small muted">${esc(b.category)}${b.hours ? ' · ' + esc(b.hours) : ''}${b.program ? ' · Programa: ' + esc(b.program) : ''}</div></div>
          <div class="result-actions"><a class="btn btn-primary btn-sm" href="/s/${esc(b.code)}">Ver sucursal</a></div>
        </article>`).join('')}</div>
      <h2 style="margin-top:28px">Programas</h2>
      <div class="stack">${programs.map((p) => `<div class="panel"><h3>${esc(p.name)}</h3><p style="margin:0">${p.kind === 'stamps' ? 'Sellos' : 'Puntos'}. Aplica en: ${esc(p.branches.join(', '))}.
        ${p.branches.length > 1 ? 'Estas sucursales comparten saldo porque el negocio configuró un programa común.' : 'El saldo solo vale en esta sucursal.'}</p></div>`).join('')}</div>`;
  } catch (e) {
    $('#view').innerHTML = e.status === 404
      ? `<div class="panel empty"><p><b>Este negocio no está publicado.</b></p><p>Puede estar en revisión o ya no participar.</p><a class="btn btn-primary" href="/directorio">Ir al directorio</a></div>`
      : errorBlock(e, 'retry');
    $('#retry')?.addEventListener('click', load);
  }
}
load();
