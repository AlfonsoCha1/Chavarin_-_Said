import { mountChrome, api, esc, $, $$, showStatus, statusHtml, fmtDate, fmtDateTime, fmtMoney, tabs, confirmDialog, formData, getConfig } from '../app.js';
mountChrome();

const loaders = {};
const loaded = new Set();
function wrapLoad(id, fn) {
  loaders[id] = async () => {
    const box = $(`#a-${id}`);
    box.innerHTML = '<div class="skeleton" style="height:220px"></div>';
    try { await fn(box); loaded.add(id); } catch (e) {
      box.innerHTML = statusHtml('err', 'No se pudo cargar', e.message);
    }
  };
}

async function init() {
  let me;
  try { me = await api('/api/staff/me'); } catch {
    $('#gate').innerHTML = `<div class="panel empty"><p><b>Entra con una cuenta de administración.</b></p><a class="btn btn-primary" href="/entrar">Entrar</a></div>`;
    return;
  }
  if (!me.user.isAdmin) {
    $('#gate').innerHTML = `<div class="panel empty"><p><b>Esta sección es solo para la administración de la plataforma.</b></p></div>`;
    return;
  }
  $('#gate').hidden = true;
  $('#ui').hidden = false;
  $('#who').textContent = me.user.name;
  tabs($('.tabs'), (t) => { if (!loaded.has(t)) loaders[t]?.(); });
}
$('#logout').addEventListener('click', async () => { await api('/api/staff/logout', { method: 'POST', body: {} }).catch(() => {}); location.href = '/entrar'; });

wrapLoad('resumen', async (box) => {
  const o = await api('/api/admin/overview');
  const cfg = await getConfig();
  box.innerHTML = `<div class="metrics">
    <div class="metric"><b>${o.approved}</b><span>negocios publicados</span></div><div class="metric"><b>${o.pending}</b><span>solicitudes por revisar</span></div>
    <div class="metric"><b>${o.pilots}</b><span>en piloto</span></div><div class="metric"><b>${o.open_incidents}</b><span>incidentes abiertos</span></div>
    <div class="metric"><b>${o.past_due}</b><span>mensualidades vencidas</span></div><div class="metric"><b>${o.wallet_failed}</b><span>actualizaciones Wallet fallidas</span></div>
    <div class="metric"><b>${o.privacy_open}</b><span>solicitudes de datos abiertas</span></div></div>
    ${cfg.demoMode ? `<div class="panel" style="margin-top:20px"><h3>Demostración</h3><p>Borra todo y vuelve a cargar los negocios ficticios. Úsalo antes de una visita.</p>
      <button class="btn btn-danger" id="reset" type="button">Reiniciar demostración</button><div id="rmsg" style="margin-top:10px"></div></div>` : ''}`;
  $('#reset')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Reiniciar demostración', body: 'Se borran todos los datos y se cargan de nuevo los negocios ficticios. Tu sesión se cerrará.', confirmText: 'Reiniciar', danger: true });
    if (!ok) return;
    showStatus($('#rmsg'), 'pend', 'Reiniciando…');
    try { await api('/api/demo/reset', { method: 'POST', body: {}, timeoutMs: 60000 }); location.href = '/entrar'; } catch (e) { showStatus($('#rmsg'), 'err', e.message); }
  });
});

wrapLoad('negocios', async (box) => {
  const { companies } = await api('/api/admin/companies');
  const ST = { pending: ['Por revisar', 'tag-pend'], approved: ['Publicado', 'tag-ok'], rejected: ['Rechazado', 'tag-bad'], suspended: ['Suspendido', 'tag-bad'], cancelled: ['Cancelado', 'tag'] };
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Negocio</th><th>Giro</th><th>Estado</th><th class="num">Sucursales</th><th class="num">Tarjetas</th><th class="num">Compras 30 d</th><th>Plan</th><th>Piloto</th><th></th></tr></thead><tbody>${companies.map((c) => `
    <tr><td><b>${esc(c.name)}</b>${c.is_demo ? ' <span class="tag tag-sim">ficticio</span>' : ''}<br><span class="small muted">${fmtDate(c.created_at)}</span></td><td class="small">${esc(c.categories ?? '')}</td>
    <td><span class="tag ${ST[c.status][1]}">${ST[c.status][0]}</span>${c.review_note ? `<br><span class="small muted">${esc(c.review_note)}</span>` : ''}</td>
    <td class="num">${c.branches}</td><td class="num">${c.cards}</td><td class="num">${c.purchases_30d}</td><td>${esc(c.plan ?? '')} · ${esc(c.sub_status ?? '')}</td>
    <td>${c.pilot ? `<span class="tag tag-ok">Sí</span><br><span class="small muted">${fmtDate(c.pilot_start)} – ${fmtDate(c.pilot_end)}</span>` : 'No'}</td>
    <td><div class="row" style="gap:6px">${c.status !== 'approved' ? `<button class="btn btn-primary btn-sm" data-st="approved" data-id="${esc(c.id)}" type="button">Aprobar</button>` : ''}
      ${c.status === 'pending' ? `<button class="btn btn-danger btn-sm" data-st="rejected" data-id="${esc(c.id)}" type="button">Rechazar</button>` : ''}
      ${c.status === 'approved' ? `<button class="btn btn-danger btn-sm" data-st="suspended" data-id="${esc(c.id)}" type="button">Suspender</button>` : ''}
      <button class="btn btn-secondary btn-sm" data-pilot="${esc(c.id)}" data-on="${c.pilot}" type="button">${c.pilot ? 'Quitar piloto' : 'Marcar piloto'}</button></div></td></tr>`).join('')}</tbody></table></div><div id="nmsg" style="margin-top:10px"></div>`;
  $$('[data-st]').forEach((b) => b.addEventListener('click', async () => {
    const note = b.dataset.st === 'approved' ? '' : prompt('Motivo (se guarda en la bitácora):');
    if (note === null) return;
    try { const r = await api(`/api/admin/companies/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.st, note } }); await loaders.negocios(); showStatus($('#nmsg'), 'ok', r.message); } catch (e) { showStatus($('#nmsg'), 'err', e.message); }
  }));
  $$('[data-pilot]').forEach((b) => b.addEventListener('click', async () => {
    const on = b.dataset.on !== 'true';
    const body = { pilot: on };
    if (on) {
      body.start = new Date().toISOString().slice(0, 10);
      body.end = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
      body.notes = prompt('Notas del piloto (qué se mide, responsable):') ?? '';
    }
    try { await api(`/api/admin/companies/${b.dataset.pilot}/pilot`, { method: 'PATCH', body }); await loaders.negocios(); } catch (e) { showStatus($('#nmsg'), 'err', e.message); }
  }));
});

wrapLoad('categorias', async (box) => {
  const { categories } = await api('/api/admin/categories');
  const byParent = (pid) => categories.filter((c) => c.parent_id === pid).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const rows = (pid, depth) => byParent(pid).map((c) => `
    <tr><td style="padding-left:${12 + depth * 22}px">${depth ? '└ ' : ''}<b>${esc(c.name)}</b> <span class="small muted mono">${esc(c.slug)}</span></td><td class="num">${c.sort_order}</td><td class="num">${c.branches}</td>
    <td>${c.active ? '<span class="tag tag-ok">Activa</span>' : '<span class="tag">Inactiva</span>'}</td>
    <td><button class="btn btn-secondary btn-sm" data-rename="${c.id}" data-name="${esc(c.name)}" type="button">Renombrar</button> <button class="btn btn-secondary btn-sm" data-order="${c.id}" type="button">Orden</button>
      <button class="btn btn-secondary btn-sm" data-active="${c.id}" data-on="${c.active}" type="button">${c.active ? 'Desactivar' : 'Activar'}</button></td></tr>${rows(c.id, depth + 1)}`).join('');
  box.innerHTML = `<p class="muted">Las categorías viven en la base de datos: se agregan y ordenan aquí sin modificar código. El directorio y el registro de negocios las leen al momento.</p>
    <div class="table-wrap"><table><thead><tr><th>Categoría</th><th class="num">Orden</th><th class="num">Sucursales</th><th>Estado</th><th></th></tr></thead><tbody>${rows(null, 0)}</tbody></table></div>
    <div id="cmsg" style="margin-top:10px"></div>
    <form class="panel row" id="addCat" style="margin-top:16px;align-items:flex-end" novalidate><div style="flex:1;min-width:200px"><label>Nueva categoría</label><input name="name" placeholder="Veterinarias"></div>
      <div style="min-width:220px"><label>Dentro de</label><select name="parentId"><option value="">(categoría principal)</option>${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div style="width:100px"><label>Orden</label><input name="sortOrder" inputmode="numeric" value="10"></div><button class="btn btn-primary" type="submit">Agregar</button></form>`;
  const patch = async (id, body) => { try { await api(`/api/admin/categories/${id}`, { method: 'PATCH', body }); await loaders.categorias(); } catch (e) { showStatus($('#cmsg'), 'err', e.message); } };
  $$('[data-rename]').forEach((b) => b.addEventListener('click', () => { const n = prompt('Nuevo nombre:', b.dataset.name); if (n) patch(b.dataset.rename, { name: n }); }));
  $$('[data-order]').forEach((b) => b.addEventListener('click', () => { const n = prompt('Número de orden (menor aparece primero):'); if (n) patch(b.dataset.order, { sortOrder: Number(n) }); }));
  $$('[data-active]').forEach((b) => b.addEventListener('click', () => patch(b.dataset.active, { active: b.dataset.on !== 'true' })));
  $('#addCat').addEventListener('submit', async (e) => {
    e.preventDefault(); const d = formData(e.target);
    try { const r = await api('/api/admin/categories', { method: 'POST', body: { ...d, parentId: d.parentId ? Number(d.parentId) : null } }); await loaders.categorias(); showStatus($('#cmsg'), 'ok', r.message); } catch (err) { showStatus($('#cmsg'), 'err', err.message); }
  });
});

wrapLoad('pagos', async (box) => {
  const { subscriptions, payments } = await api('/api/admin/subscriptions');
  box.innerHTML = `<p class="muted">Pagos registrados manualmente durante el piloto. No hay cobro automático.</p>
    <div class="table-wrap"><table><thead><tr><th>Negocio</th><th>Plan</th><th>Estado</th><th class="num">Mensualidad</th><th>Pagado hasta</th><th></th></tr></thead><tbody>${subscriptions.map((s) => `
      <tr><td>${esc(s.name)}</td><td>${esc(s.plan)}</td><td>${esc(s.status)}</td><td class="num">${fmtMoney(s.monthly_price_cents)}</td><td>${fmtDate(s.paid_through)}</td>
      <td><select data-sub="${esc(s.company_id)}" style="min-height:36px;padding:4px 8px;width:auto">${['trial', 'active', 'past_due', 'suspended', 'cancelled'].map((x) => `<option ${x === s.status ? 'selected' : ''}>${x}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
    <form class="panel" id="pay" style="margin-top:16px" novalidate><h3>Registrar pago</h3>
      <div class="row"><div style="min-width:220px"><label>Negocio</label><select name="companyId">${subscriptions.map((s) => `<option value="${esc(s.company_id)}">${esc(s.name)}</option>`).join('')}</select></div>
      <div style="width:130px"><label>Monto ($)</label><input name="amount" inputmode="decimal"></div>
      <div><label>Concepto</label><select name="concept"><option value="mensualidad">Mensualidad</option><option value="instalacion">Instalación</option><option value="otro">Otro</option></select></div>
      <div><label>Método</label><select name="method"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="otro">Otro</option></select></div>
      <div style="width:140px"><label>Periodo</label><input name="periodMonth" placeholder="2026-10"></div><div style="width:160px"><label>Referencia</label><input name="reference"></div></div>
      <div id="pmsg" style="margin-top:10px"></div><button class="btn btn-primary" type="submit" style="margin-top:10px">Registrar pago</button></form>
    <h3 style="margin-top:20px">Pagos recientes</h3>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Negocio</th><th>Concepto</th><th>Método</th><th class="num">Monto</th><th>Registró</th></tr></thead><tbody>${payments.map((p) => `<tr><td>${fmtDate(p.created_at)}</td><td>${esc(p.name)}</td><td>${esc(p.concept)} ${esc(p.period_month ?? '')}</td><td>${esc(p.method)} ${esc(p.reference ?? '')}</td><td class="num">${fmtMoney(p.amount_cents)}</td><td>${esc(p.recorded_by_name)}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-sub]').forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/admin/subscriptions/${s.dataset.sub}`, { method: 'PATCH', body: { status: s.value } }); showStatus($('#pmsg'), 'ok', 'Estado de suscripción actualizado.', 'Suspender la suscripción no borra saldos. Para bloquear operaciones usa “Suspender” en Negocios.'); } catch (e) { showStatus($('#pmsg'), 'err', e.message); }
  }));
  $('#pay').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/api/admin/payments', { method: 'POST', body: formData(e.target) }); await loaders.pagos(); showStatus($('#pmsg'), 'ok', r.message); } catch (err) { showStatus($('#pmsg'), 'err', err.message); }
  });
});

wrapLoad('incidentes', async (box) => {
  const { incidents } = await api('/api/admin/incidents');
  box.innerHTML = `<p class="muted">Prioridad: caídas, canjes bloqueados y seguridad primero; dudas de configuración después. Informar plazos realistas.</p>
    <div class="stack">${incidents.map((i) => `<div class="panel"><div class="row between"><b>${esc(i.title)}</b><span class="row"><span class="tag ${i.priority === 'alta' ? 'tag-bad' : 'tag-pend'}">${esc(i.priority)}</span><span class="tag ${i.status === 'resuelto' ? 'tag-ok' : ''}">${esc(i.status)}</span></span></div>
      <p class="small muted" style="margin:4px 0">${esc(i.company ?? 'Plataforma')} · ${esc(i.kind)} · ${fmtDateTime(i.created_at)}${i.assigned_to ? ' · responsable ' + esc(i.assigned_to) : ''}</p>
      ${i.description ? `<p style="margin:6px 0">${esc(i.description)}</p>` : ''}${i.resolution ? `<p class="small"><b>Resolución:</b> ${esc(i.resolution)}</p>` : ''}
      ${i.status !== 'resuelto' ? `<div class="row"><button class="btn btn-secondary btn-sm" data-assign="${esc(i.id)}" type="button">Asignar responsable</button><button class="btn btn-primary btn-sm" data-resolve="${esc(i.id)}" type="button">Marcar resuelto</button></div>` : ''}</div>`).join('') || '<div class="panel empty"><p>Sin incidentes.</p></div>'}</div>
    <form class="panel" id="newInc" style="margin-top:16px" novalidate><h3>Abrir incidente</h3>
      <div class="row"><div><label>Tipo</label><select name="kind"><option value="falla">Falla</option><option value="seguridad">Seguridad</option><option value="soporte">Soporte</option><option value="datos">Datos</option></select></div>
      <div><label>Prioridad</label><select name="priority"><option value="alta">Alta</option><option value="media" selected>Media</option><option value="baja">Baja</option></select></div>
      <div style="flex:1;min-width:220px"><label>Título</label><input name="title"></div></div>
      <div class="field" style="margin-top:8px"><label>Descripción (solo hechos verificados)</label><textarea name="description"></textarea></div>
      <div id="imsg"></div><button class="btn btn-primary" type="submit">Abrir</button></form>`;
  $$('[data-assign]').forEach((b) => b.addEventListener('click', async () => { const who = prompt('Responsable:'); if (!who) return; await api(`/api/admin/incidents/${b.dataset.assign}`, { method: 'PATCH', body: { assignedTo: who, status: 'en_proceso' } }); loaders.incidentes(); }));
  $$('[data-resolve]').forEach((b) => b.addEventListener('click', async () => { const r = prompt('Resolución:'); if (!r) return; await api(`/api/admin/incidents/${b.dataset.resolve}`, { method: 'PATCH', body: { status: 'resuelto', resolution: r } }); loaders.incidentes(); }));
  $('#newInc').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/api/admin/incidents', { method: 'POST', body: formData(e.target) }); loaders.incidentes(); } catch (err) { showStatus($('#imsg'), 'err', err.message); } });
});

wrapLoad('integraciones', async (box) => {
  const [i, { jobs }] = await Promise.all([api('/api/admin/integrations'), api('/api/admin/wallet-jobs')]);
  box.innerHTML = `<div class="grid-2"><div class="panel"><h3>Estado</h3>
      <div class="table-wrap"><table><tbody>
        <tr><th>Base de datos</th><td>${esc(i.database)}</td></tr>
        <tr><th>SMS</th><td><span class="tag tag-sim">${esc(i.messaging.sms)}</span></td></tr>
        <tr><th>WhatsApp</th><td><span class="tag tag-sim">${esc(i.messaging.whatsapp)}</span></td></tr>
        <tr><th>Correo</th><td><span class="tag tag-sim">${esc(i.messaging.email)}</span></td></tr>
        <tr><th>Google Wallet</th><td><span class="tag tag-sim">${esc(i.wallet.google)}</span></td></tr>
        <tr><th>Apple Wallet</th><td><span class="tag tag-pend">${esc(i.wallet.apple)}</span></td></tr>
        <tr><th>Respaldos</th><td class="small">${esc(i.backups)}</td></tr>
        <tr><th>Despertador</th><td>${esc(i.keepalive)}</td></tr>
        <tr><th>Cola Wallet</th><td>${i.walletJobs.pending} pendientes · ${i.walletJobs.failed} fallidas · ${i.walletJobs.done} hechas</td></tr>
      </tbody></table></div></div>
    <div class="panel"><h3>Pruebas de contingencia</h3>
      <label class="check"><input type="checkbox" id="wfail" ${i.walletSimulateFailure ? 'checked' : ''}><span>Simular falla del proveedor de Wallet. Las compras siguen guardándose; la cola queda en “fallida” y al reintentar copia el saldo vigente sin sumar puntos.</span></label>
      <div class="row" style="margin-top:12px"><button class="btn btn-secondary" id="retry" type="button">Reintentar cola de Wallet</button><button class="btn btn-secondary" id="expire" type="button">Ejecutar vencimiento de puntos</button></div>
      <div id="imsg" style="margin-top:10px"></div></div></div>
    <h3 style="margin-top:20px">Últimas tareas de Wallet</h3>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Tarjeta</th><th>Estado</th><th class="num">Intentos</th><th class="num">Saldo servidor</th><th class="num">Saldo en pase</th><th>Error</th></tr></thead><tbody>${jobs.map((j) => `<tr><td>${j.id}</td><td class="mono">${esc(j.code)}</td><td>${esc(j.status)}</td><td class="num">${j.attempts}</td><td class="num">${j.server_balance}</td><td class="num">${j.displayed_balance ?? '—'}</td><td class="small">${esc(j.last_error ?? '')}</td></tr>`).join('') || '<tr><td colspan="7">Sin tareas.</td></tr>'}</tbody></table></div>`;
  $('#wfail').addEventListener('change', async (e) => { await api('/api/admin/settings/wallet-failure', { method: 'POST', body: { enabled: e.target.checked } }); showStatus($('#imsg'), 'ok', e.target.checked ? 'Falla simulada activada.' : 'Falla simulada desactivada.'); });
  $('#retry').addEventListener('click', async () => { const r = await api('/api/admin/wallet-jobs/retry', { method: 'POST', body: {} }); await loaders.integraciones(); showStatus($('#imsg'), 'ok', `Procesadas ${r.processed}: ${r.done} actualizadas, ${r.failed} fallidas.`); });
  $('#expire').addEventListener('click', async () => { const r = await api('/api/admin/jobs/expire-points', { method: 'POST', body: {} }); showStatus($('#imsg'), 'ok', `Revisadas ${r.checked} tarjetas; vencieron ${r.expired}.`); });
});

wrapLoad('privacidad', async (box) => {
  const { requests } = await api('/api/admin/privacy-requests');
  const K = { acceso: 'Acceso', rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición', baja_publicidad: 'Baja de publicidad' };
  box.innerHTML = `<p class="muted">Solicitudes de clientes sobre sus datos. Plazos y respuestas sujetos al aviso de privacidad y revisión legal.</p>
    ${requests.length ? `<div class="table-wrap"><table><thead><tr><th>Folio</th><th>Fecha</th><th>Tipo</th><th>Negocio</th><th>Estado</th><th></th></tr></thead><tbody>${requests.map((r) => `<tr><td class="mono">${esc(r.id.slice(0, 8))}</td><td>${fmtDate(r.created_at)}</td><td>${K[r.kind]}</td><td>${esc(r.company ?? 'Plataforma')}</td><td>${esc(r.status)}${r.resolution ? `<br><span class="small muted">${esc(r.resolution)}</span>` : ''}</td>
      <td>${['recibida', 'en_proceso'].includes(r.status) ? `<button class="btn btn-secondary btn-sm" data-pr="${esc(r.id)}" type="button">Marcar atendida</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="panel empty"><p>Sin solicitudes.</p></div>'}`;
  $$('[data-pr]').forEach((b) => b.addEventListener('click', async () => { const r = prompt('Respuesta enviada al cliente:'); if (!r) return; await api(`/api/admin/privacy-requests/${b.dataset.pr}`, { method: 'PATCH', body: { status: 'atendida', resolution: r } }); loaders.privacidad(); }));
});

wrapLoad('bitacora', async (box) => {
  const { audit } = await api('/api/admin/audit');
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Negocio</th><th>Entidad</th></tr></thead><tbody>${audit.map((a) => `<tr><td>${fmtDateTime(a.created_at)}</td><td>${esc(a.actor_kind)}</td><td class="mono small">${esc(a.action)}</td><td>${esc(a.company ?? '')}</td><td class="small">${esc(a.entity ?? '')} ${esc(a.entity_id ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
});

init();
