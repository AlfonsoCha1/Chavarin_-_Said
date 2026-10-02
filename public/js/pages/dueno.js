import { mountChrome, api, esc, $, $$, showStatus, statusHtml, fmtDate, fmtDateTime, fmtMoney, unit, tabs, confirmDialog, KIND_LABEL, formData, cardHtml } from '../app.js';
mountChrome();

let me = null;
const isOwner = () => me.membership.role === 'owner';
const loaders = {};
const loaded = new Set();
const ROLE = { owner: 'Dueño', manager: 'Encargado', employee: 'Empleado' };
const RED_STATUS = { confirmed: ['Sin entregar', 'tag-pend'], delivered: ['Entregado', 'tag-ok'], disputed: ['En revisión', 'tag-bad'], reversed: ['Revertido', 'tag'] };

function wrapLoad(id, fn) {
  loaders[id] = async () => {
    const box = $(`#p-${id}`);
    box.innerHTML = '<div class="skeleton" style="height:220px"></div>';
    try { await fn(box); loaded.add(id); } catch (e) {
      box.innerHTML = statusHtml('err', 'No se pudo cargar', e.message, '<div class="row"><button class="btn btn-secondary btn-sm" type="button" data-reload>Reintentar</button></div>');
      $('[data-reload]', box).addEventListener('click', () => loaders[id]());
    }
  };
}

async function init() {
  try { me = await api('/api/staff/me'); } catch {
    $('#gate').innerHTML = `<div class="panel empty"><p><b>Entra con tu cuenta de dueño o encargado.</b></p><a class="btn btn-primary" href="/entrar">Entrar</a></div>`;
    return;
  }
  if (!me.company || me.membership.role === 'employee') {
    $('#gate').innerHTML = `<div class="panel empty"><p><b>Esta sección es para el dueño o el encargado.</b></p><a class="btn btn-primary" href="/empleado">Ir al mostrador</a></div>`;
    return;
  }
  $('#gate').hidden = true;
  $('#ui').hidden = false;
  $('#title').textContent = me.company.name;
  $('#who').textContent = `${me.user.name} · ${ROLE[me.membership.role]}`;
  if (me.company.status === 'pending') $('#notice').innerHTML = statusHtml('warn', 'Solicitud en revisión', 'Tu negocio aún no aparece en el directorio ni puede registrar compras. Mientras tanto configura empleados, premios y sucursales.');
  if (me.company.status === 'suspended') $('#notice').innerHTML = statusHtml('err', 'Servicio suspendido', 'No se pueden registrar compras ni canjes. Los saldos de tus clientes se conservan. Contacta a soporte.');
  tabs($('.tabs'), (t) => { if (!loaded.has(t)) loaders[t]?.(); });
}
$('#logout').addEventListener('click', async () => { await api('/api/staff/logout', { method: 'POST', body: {} }).catch(() => {}); location.href = '/entrar'; });

// ---------- Resumen ----------
wrapLoad('resumen', async (box) => {
  const days = Number(new URLSearchParams(location.search).get('dias') ?? 30);
  const [o, a] = await Promise.all([api(`/api/owner/overview?days=${days}`), api('/api/owner/alerts')]);
  const t = o.totals;
  const maxW = Math.max(1, ...o.weekly.map((w) => w.purchases));
  box.innerHTML = `
    <div class="row between"><h2 style="margin:0">Últimos ${o.days} días</h2>
      <label class="row small" style="font-weight:500">Periodo <select id="days" style="width:auto;min-height:36px;padding:4px 8px">${[7, 30, 90].map((d) => `<option value="${d}" ${d === o.days ? 'selected' : ''}>${d} días</option>`).join('')}</select></label></div>
    <p class="small muted">${esc(o.note)}</p>
    <div class="metrics">
      <div class="metric"><b>${t.purchases}</b><span>compras registradas</span></div>
      <div class="metric"><b>${t.active_cards}</b><span>tarjetas con compra</span></div>
      <div class="metric"><b>${t.recurrence ?? '—'}${t.recurrence != null ? '%' : ''}</b><span>volvieron 2+ veces (${t.returning_cards})</span></div>
      <div class="metric"><b>${t.new_cards}</b><span>tarjetas nuevas</span></div>
      <div class="metric"><b>${t.redemptions}</b><span>canjes (${t.points_redeemed} pts)</span></div>
      <div class="metric"><b>${t.points_issued}</b><span>puntos otorgados</span></div>
      <div class="metric"><b>${t.outstanding_points}</b><span>puntos vigentes por canjear</span></div>
      <div class="metric"><b>${t.total_cards}</b><span>tarjetas activas en total</span></div>
    </div>
    <div class="grid-2" style="margin-top:20px">
      <div class="panel"><h3>Compras registradas por semana</h3>
        ${o.weekly.length ? `<div class="bars" role="img" aria-label="Compras por semana">${o.weekly.map((w) => `<div style="height:${Math.round((w.purchases / maxW) * 100)}%"><span>${w.purchases}</span></div>`).join('')}</div>
        <div class="bars-labels">${o.weekly.map((w) => `<span>${fmtDate(w.week).replace(/ de \d{4}|\s\d{4}/, '')}</span>`).join('')}</div>` : '<p class="muted">Aún no hay compras registradas.</p>'}
      </div>
      <div class="panel"><h3>Por sucursal</h3>
        <div class="table-wrap"><table><thead><tr><th>Sucursal</th><th class="num">Compras</th><th class="num">Tarjetas</th></tr></thead><tbody>${o.byBranch.map((b) => `<tr><td>${esc(b.name)}</td><td class="num">${b.purchases}</td><td class="num">${b.cards}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </div>
    <div class="panel" style="margin-top:20px"><h3>Alertas para revisar</h3><p class="small muted">${esc(a.note)}</p>
      ${a.alerts.length ? `<ul>${a.alerts.map((x) => `<li><span class="tag ${x.level === 'revisar' ? 'tag-bad' : 'tag-pend'}">${x.level === 'revisar' ? 'Revisar' : 'Pendiente'}</span> ${esc(x.text)}</li>`).join('')}</ul>` : '<p class="muted">Sin alertas.</p>'}
    </div>`;
  $('#days').addEventListener('change', (e) => { history.replaceState(null, '', `?dias=${e.target.value}#resumen`); loaders.resumen(); });
});

// ---------- Compras ----------
wrapLoad('compras', async (box) => {
  box.innerHTML = `<form class="row" id="pq" style="margin-bottom:12px"><input id="pqq" placeholder="Buscar ticket o tarjeta" style="max-width:260px"><button class="btn btn-secondary" type="submit">Buscar</button></form><div id="plist"></div>`;
  const render = async () => {
    const q = $('#pqq').value.trim();
    const { purchases } = await api(`/api/owner/purchases?days=90${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    $('#plist').innerHTML = purchases.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Ticket</th><th>Tarjeta</th><th>Sucursal</th><th>Registró</th><th class="num">Importe</th><th class="num">Puntos</th><th>Regla</th><th></th></tr></thead><tbody>${purchases.map((p) => `
      <tr><td>${fmtDateTime(p.occurred_at)}${p.source === 'contingency' ? '<br><span class="tag tag-pend">Contingencia</span>' : ''}</td><td>${esc(p.ticket_ref)}</td><td class="mono"><a href="#tarjeta" data-card="${esc(p.code)}">${esc(p.code)}</a></td><td>${esc(p.branch)}</td><td>${esc(p.actor)}</td>
      <td class="num">${fmtMoney(p.amount_cents)}</td><td class="num">+${p.points}</td><td>v${p.program_version}</td>
      <td>${p.status === 'refunded' ? '<span class="tag tag-bad">Devuelta</span>' : `<button class="btn btn-danger btn-sm" type="button" data-refund="${esc(p.id)}" data-ticket="${esc(p.ticket_ref)}">Devolución</button>`}</td></tr>`).join('')}</tbody></table></div><div id="pmsg" style="margin-top:10px"></div>`
      : '<div class="panel empty"><p>No hay compras con ese criterio.</p></div>';
    $$('[data-refund]').forEach((b) => b.addEventListener('click', async () => {
      const reason = prompt(`Motivo de la devolución del ticket ${b.dataset.ticket} (mínimo 10 caracteres):`);
      if (!reason) return;
      try {
        const r = await api(`/api/owner/purchases/${b.dataset.refund}/refund`, { method: 'POST', body: { reason } });
        await render();
        showStatus($('#pmsg'), r.shortfall ? 'warn' : 'ok', 'Devolución registrada', r.message);
      } catch (e) { showStatus($('#pmsg'), 'err', e.message); }
    }));
    $$('[data-card]').forEach((a) => a.addEventListener('click', () => openCard(a.dataset.card)));
  };
  $('#pq').addEventListener('submit', (e) => { e.preventDefault(); render(); });
  await render();
});

// ---------- Canjes ----------
wrapLoad('canjes', async (box) => {
  const { redemptions } = await api('/api/owner/redemptions');
  box.innerHTML = redemptions.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tarjeta</th><th>Premio</th><th>Sucursal</th><th>Registró</th><th>Estado</th><th></th></tr></thead><tbody>${redemptions.map((r) => `
    <tr><td>${fmtDateTime(r.created_at)}</td><td class="mono">${esc(r.code)}</td><td>${esc(r.reward_name)} (−${r.cost})</td><td>${esc(r.branch)}</td><td>${esc(r.actor)}</td>
    <td><span class="tag ${RED_STATUS[r.status][1]}">${RED_STATUS[r.status][0]}</span>${r.dispute_note ? `<br><span class="small muted">${esc(r.dispute_note)}</span>` : ''}${r.resolution ? `<br><span class="small muted">Resolución: ${esc(r.resolution)}</span>` : ''}</td>
    <td>${['confirmed', 'delivered'].includes(r.status) ? `<button class="btn btn-secondary btn-sm" data-dispute="${esc(r.id)}" type="button">Abrir revisión</button>` : ''}
        ${r.status === 'disputed' ? `<button class="btn btn-secondary btn-sm" data-resolve="${esc(r.id)}" data-res="upheld" type="button">Sí se entregó</button> <button class="btn btn-danger btn-sm" data-resolve="${esc(r.id)}" data-res="reversed" data-cost="${r.cost}" type="button">Reponer puntos</button>` : ''}</td></tr>`).join('')}</tbody></table></div><div id="rmsg" style="margin-top:10px"></div>`
    : '<div class="panel empty"><p>Aún no hay canjes.</p></div>';
  $$('[data-dispute]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt('¿Qué reporta el cliente? (mínimo 10 caracteres)');
    if (!note) return;
    try { await api(`/api/owner/redemptions/${b.dataset.dispute}/dispute`, { method: 'POST', body: { note } }); await loaders.canjes(); showStatus($('#rmsg'), 'ok', 'Canje en revisión', 'Revisa con el empleado y el comprobante antes de resolver.'); } catch (e) { showStatus($('#rmsg'), 'err', e.message); }
  }));
  $$('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
    const reversed = b.dataset.res === 'reversed';
    const note = prompt(reversed ? `Se repondrán ${b.dataset.cost} puntos (sin generar otro canje). Escribe la autorización y motivo:` : 'Escribe cómo se confirmó la entrega:');
    if (!note) return;
    try { const r = await api(`/api/owner/redemptions/${b.dataset.resolve}/resolve`, { method: 'POST', body: { resolution: b.dataset.res, note } }); await loaders.canjes(); showStatus($('#rmsg'), 'ok', 'Revisión resuelta', r.message); } catch (e) { showStatus($('#rmsg'), 'err', e.message); }
  }));
});

// ---------- Tarjetas y ajustes ----------
let openCard = () => {};
wrapLoad('tarjeta', async (box) => {
  box.innerHTML = `
    <form class="row" id="cq"><label class="sr-only" for="ccode">Número de tarjeta</label><input id="ccode" class="code-input" placeholder="C-XXXXXX" style="max-width:220px"><button class="btn btn-primary" type="submit">Abrir tarjeta</button></form>
    <p class="small muted">La búsqueda es por número de tarjeta, no por datos personales.</p>
    <div id="cview"></div>
    <div class="panel" style="margin-top:20px"><h3>Unir dos tarjetas del mismo cliente (cuenta duplicada)</h3>
      <form id="merge" class="stack" novalidate>
        <div class="row"><div style="flex:1;min-width:160px"><label for="mfrom">Tarjeta que se cancela</label><input id="mfrom" class="code-input" name="fromCode"></div>
        <div style="flex:1;min-width:160px"><label for="mto">Tarjeta que se conserva</label><input id="mto" class="code-input" name="toCode"></div></div>
        <div><label for="mreason">Motivo</label><input id="mreason" name="reason" placeholder="Cliente registró dos veces con distinto contacto"></div>
        <div class="row" style="align-items:flex-end"><div><label for="mcode">Código del titular (si son de titulares distintos)</label><input id="mcode" name="verificationCode" inputmode="numeric" maxlength="6" style="width:160px"></div>
          <button class="btn btn-secondary btn-sm" type="button" id="msend">Enviar código al titular</button></div>
        <div id="mmsg"></div>
        <button class="btn btn-primary" type="submit">Unir tarjetas</button>
      </form></div>`;
  openCard = async (code) => {
    $('[data-tab="tarjeta"]').click();
    $('#ccode').value = code;
    const v = $('#cview');
    v.innerHTML = '<div class="skeleton" style="height:200px;margin-top:12px"></div>';
    try {
      const c = await api(`/api/owner/cards/${encodeURIComponent(code)}`);
      v.innerHTML = `<div class="grid-2" style="margin-top:16px">
        <div>${cardHtml({ company: me.company.name, program: c.card.programName, balance: c.card.balance, kind: c.card.kind, code: c.card.code, color: me.company.cardColor, rewards: c.rewards })}
          <p style="margin-top:10px">Titular: <b>${esc(c.holderContact.name)}</b> ${c.holderContact.email ? '· ' + esc(c.holderContact.email) : ''} ${c.holderContact.phone ? '· ' + esc(c.holderContact.phone) : ''}<br>
          Estado: <b>${esc(c.card.status)}</b>${c.replacedBy ? ` → reemplazada por <span class="mono">${esc(c.replacedBy)}</span>` : ''} · creada ${fmtDate(c.createdAt)}</p></div>
        <div class="stack">
          <form class="panel" id="adj" novalidate><h3>Ajuste autorizado</h3><p class="small muted">No borra nada: agrega un movimiento con motivo, autor y fecha.</p>
            <div class="row"><div style="width:130px"><label for="apts">Puntos (+/−)</label><input id="apts" inputmode="numeric" placeholder="-90"></div>
            <div style="width:150px"><label for="arel">Movimiento # (opcional)</label><input id="arel" inputmode="numeric"></div></div>
            <div class="field" style="margin-top:8px"><label for="areason">Motivo</label><input id="areason" placeholder="Compra T-208 recibió 100 en lugar de 10"></div>
            <div id="amsg"></div><button class="btn btn-primary" type="submit">Registrar ajuste</button></form>
          <form class="panel" id="rep" novalidate><h3>Reponer tarjeta perdida</h3><p class="small muted">Requiere código enviado al contacto verificado del titular. El QR solo identifica la tarjeta, no a su dueño.</p>
            <div class="row" style="align-items:flex-end"><button class="btn btn-secondary btn-sm" type="button" id="rsend">Enviar código al titular</button>
            <div><label for="rcode">Código</label><input id="rcode" inputmode="numeric" maxlength="6" style="width:130px"></div></div>
            <div class="field" style="margin-top:8px"><label for="rreason">Motivo</label><input id="rreason" placeholder="Cliente perdió el celular"></div>
            <div id="rmsg2"></div><button class="btn btn-primary" type="submit">Reponer con número nuevo</button></form>
        </div></div>
        <h3 style="margin-top:20px">Historial completo</h3>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Fecha</th><th>Movimiento</th><th>Detalle</th><th>Autor</th><th class="num">Cambio</th><th class="num">Saldo</th></tr></thead><tbody>${c.ledger.map((m) => `
          <tr><td>${m.id}</td><td>${fmtDateTime(m.created_at)}</td><td>${esc(KIND_LABEL[m.kind] ?? m.kind)}${m.program_version ? ` <span class="small muted">regla v${m.program_version}</span>` : ''}</td>
          <td>${esc(m.ticket_ref ?? m.reward_name ?? '')}${m.branch ? `<br><span class="small muted">${esc(m.branch)}</span>` : ''}${m.reason ? `<br><span class="small">${esc(m.reason)}</span>` : ''}${m.related_entry_id ? `<br><span class="small muted">relacionado con #${m.related_entry_id}</span>` : ''}</td>
          <td>${esc(m.actor ?? 'Sistema')}</td><td class="num ${m.points > 0 ? 'pos' : 'neg'}">${m.points > 0 ? '+' : ''}${m.points}</td><td class="num">${m.balance_after}</td></tr>`).join('')}</tbody></table></div>`;
      $('#adj').addEventListener('submit', async (e) => {
        e.preventDefault();
        const points = Number($('#apts').value);
        const ok = await confirmDialog({ title: 'Confirmar ajuste', body: `Se registrará ${points > 0 ? '+' : ''}${points} en ${c.card.code} con tu nombre y el motivo. El historial original no se borra.`, confirmText: 'Registrar ajuste' });
        if (!ok) return;
        try {
          const r = await api('/api/owner/adjustments', { method: 'POST', body: { cardCode: c.card.code, points, reason: $('#areason').value, relatedEntryId: $('#arel').value ? Number($('#arel').value) : null } });
          await openCard(c.card.code);
          showStatus($('#amsg'), 'ok', 'Ajuste registrado', r.message);
        } catch (err) { showStatus($('#amsg'), 'err', err.message); }
      });
      $('#rsend').addEventListener('click', async () => {
        try { const r = await api(`/api/staff/cards/${encodeURIComponent(c.card.code)}/send-code`, { method: 'POST', body: { purpose: 'holder' } }); showStatus($('#rmsg2'), 'warn', 'Código enviado (simulado)', r.message, ' <a href="/buzon-demo" target="_blank">Abrir buzón</a>'); } catch (err) { showStatus($('#rmsg2'), 'err', err.message); }
      });
      $('#rep').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { const r = await api(`/api/owner/cards/${encodeURIComponent(c.card.code)}/replace`, { method: 'POST', body: { reason: $('#rreason').value, verificationCode: $('#rcode').value } }); await openCard(r.newCode); showStatus($('#amsg'), 'ok', 'Tarjeta repuesta', r.message); } catch (err) { showStatus($('#rmsg2'), 'err', err.message); }
      });
    } catch (e) {
      v.innerHTML = statusHtml('err', e.status === 404 ? 'Tarjeta no encontrada en este negocio' : 'No se pudo abrir', e.message);
    }
  };
  $('#cq').addEventListener('submit', (e) => { e.preventDefault(); openCard($('#ccode').value); });
  $('#msend').addEventListener('click', async () => {
    try { const r = await api(`/api/staff/cards/${encodeURIComponent($('#mfrom').value)}/send-code`, { method: 'POST', body: { purpose: 'holder' } }); showStatus($('#mmsg'), 'warn', 'Código enviado (simulado)', r.message); } catch (err) { showStatus($('#mmsg'), 'err', err.message); }
  });
  $('#merge').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const ok = await confirmDialog({ title: 'Unir tarjetas', body: `Todo el saldo de ${d.fromCode} pasará a ${d.toCode} y ${d.fromCode} dejará de funcionar. Queda en el historial de ambas.`, confirmText: 'Unir', danger: true });
    if (!ok) return;
    try { const r = await api('/api/owner/cards/merge', { method: 'POST', body: { ...d, verificationCode: d.verificationCode || undefined } }); showStatus($('#mmsg'), 'ok', 'Tarjetas unidas', r.message); } catch (err) { showStatus($('#mmsg'), 'err', err.message); }
  });
});

// ---------- Empleados ----------
wrapLoad('empleados', async (box) => {
  const [{ employees }, comp] = await Promise.all([api('/api/owner/employees'), api('/api/owner/company')]);
  box.innerHTML = `
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Rol</th><th>Sucursal</th><th>Estado</th><th>Última actividad</th><th></th></tr></thead><tbody>${employees.map((e) => `
      <tr><td>${esc(e.name)}<br><span class="small muted">${esc(e.email)}</span></td><td>${ROLE[e.role]}</td><td>${esc(e.branch ?? 'Todas')}</td>
      <td>${e.status === 'active' ? '<span class="tag tag-ok">Activo</span>' : `<span class="tag tag-bad">Revocado</span><br><span class="small muted">${fmtDate(e.revoked_at)} · ${esc(e.revoke_reason ?? '')}</span>`}</td>
      <td>${e.last_seen ? fmtDateTime(e.last_seen) : '—'}</td>
      <td>${e.status === 'active' && e.role !== 'owner' && (isOwner() || e.role === 'employee') ? `<button class="btn btn-danger btn-sm" data-revoke="${esc(e.id)}" data-name="${esc(e.name)}" type="button">Revocar acceso</button> <button class="btn btn-secondary btn-sm" data-reset="${esc(e.id)}" type="button">Contraseña temporal</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div id="emsg" style="margin-top:10px"></div>
    <form class="panel" id="addEmp" style="margin-top:20px;max-width:640px" novalidate>
      <h3>Agregar persona</h3><p class="small muted">Cuentas individuales: así cada compra y canje queda a nombre de quien la hizo.</p>
      <div class="row"><div style="flex:1;min-width:180px"><label for="ename">Nombre</label><input id="ename" name="name"></div><div style="flex:1;min-width:200px"><label for="eemail">Correo</label><input id="eemail" name="email" type="email"></div></div>
      <div class="row" style="margin-top:8px"><div><label for="erole">Rol</label><select id="erole" name="role"><option value="employee">Empleado</option>${isOwner() ? '<option value="manager">Encargado</option>' : ''}</select></div>
        <div><label for="ebranch">Sucursal</label><select id="ebranch" name="branchId"><option value="">Todas</option>${comp.branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></div>
        <div><label for="epass">Contraseña temporal</label><input id="epass" name="tempPassword" type="text" minlength="10" autocomplete="off"></div></div>
      <div id="addmsg" style="margin-top:10px"></div>
      <button class="btn btn-primary" type="submit" style="margin-top:10px">Crear cuenta</button>
    </form>`;
  $$('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    const reason = prompt(`Motivo para revocar el acceso de ${b.dataset.name}:`);
    if (!reason) return;
    try { const r = await api(`/api/owner/employees/${b.dataset.revoke}/revoke`, { method: 'POST', body: { reason } }); await loaders.empleados(); showStatus($('#emsg'), 'ok', 'Acceso revocado', `${r.message} Sesiones cerradas: ${r.sessionsClosed}.`); } catch (e) { showStatus($('#emsg'), 'err', e.message); }
  }));
  $$('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const tempPassword = prompt('Nueva contraseña temporal (mínimo 10 caracteres). Entrégala en persona:');
    if (!tempPassword) return;
    try { const r = await api(`/api/owner/employees/${b.dataset.reset}/reset-password`, { method: 'POST', body: { tempPassword } }); showStatus($('#emsg'), 'ok', r.message); } catch (e) { showStatus($('#emsg'), 'err', e.message); }
  }));
  $('#addEmp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    try { const r = await api('/api/owner/employees', { method: 'POST', body: { ...d, branchId: d.branchId || null } }); await loaders.empleados(); showStatus($('#emsg'), 'ok', 'Cuenta creada', r.message); } catch (err) { showStatus($('#addmsg'), 'err', err.message); }
  });
});

// ---------- Programa y premios ----------
wrapLoad('programa', async (box) => {
  const { programs, rewardCostNoticeDays } = await api('/api/owner/programs');
  const today = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);
  box.innerHTML = programs.map((p) => {
    const v = p.versions.find((x) => new Date(x.effective_from) <= new Date()) ?? p.versions[p.versions.length - 1];
    const u = (n) => unit(p.kind, n);
    return `<article class="panel" style="margin-bottom:20px">
      <div class="row between"><h2 style="margin:0">${esc(p.name)}</h2><span class="tag ${p.status === 'active' ? 'tag-ok' : 'tag-bad'}">${p.status === 'active' ? 'Activo' : 'En pausa'}</span></div>
      <p class="muted">${p.kind === 'stamps' ? 'Sellos' : 'Puntos'} · Sucursales: ${p.branches.map((b) => esc(b.name)).join(', ')}${p.branches.length > 1 ? ' (comparten saldo)' : ''}</p>
      <p><b>Regla vigente (v${v.version}):</b> ${v.points_per_purchase} ${u(v.points_per_purchase)} por compra elegible. ${esc(v.eligible_description)} ${v.min_purchase_cents ? 'Mínimo ' + fmtMoney(v.min_purchase_cents) + '.' : ''} ${v.expiration_days ? `Vencen tras ${v.expiration_days} días sin compras.` : 'Sin vencimiento.'}</p>
      ${p.versions.filter((x) => new Date(x.effective_from) > new Date()).map((x) => `<div class="status status-warn"><b>Cambio programado v${x.version}</b><span>Desde ${fmtDate(x.effective_from)}: ${x.points_per_purchase} por compra. Los saldos actuales no se recalculan.</span></div>`).join('')}
      <h3 style="margin-top:16px">Premios</h3>
      <div class="table-wrap"><table><thead><tr><th>Premio</th><th class="num">Costo</th><th class="num">Existencias</th><th>Estado</th><th></th></tr></thead><tbody>${p.rewards.map((r) => `
        <tr><td>${esc(r.name)}</td><td class="num">${r.cost}${r.pending_cost ? `<br><span class="small muted">→ ${r.pending_cost} desde ${fmtDate(r.pending_cost_from)}</span>` : ''}</td><td class="num">${r.stock ?? 'sin límite'}</td>
        <td>${r.active ? '<span class="tag tag-ok">Activo</span>' : '<span class="tag">Inactivo</span>'}</td>
        <td><button class="btn btn-secondary btn-sm" type="button" data-stock="${esc(r.id)}">Existencias</button>${isOwner() ? ` <button class="btn btn-secondary btn-sm" type="button" data-cost="${esc(r.id)}" data-current="${r.cost}">Costo</button> <button class="btn btn-secondary btn-sm" type="button" data-toggle="${esc(r.id)}" data-active="${r.active}">${r.active ? 'Desactivar' : 'Activar'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Subir el costo de un premio se aplica ${rewardCostNoticeDays} días después, para no sorprender a quien ya ahorró. Bajarlo aplica de inmediato.</p>
      <div data-pmsg="${esc(p.id)}"></div>
      ${isOwner() ? `
      <details style="margin-top:12px"><summary><b>Agregar premio</b></summary>
        <form class="row" data-addreward="${esc(p.id)}" style="margin-top:10px;align-items:flex-end" novalidate>
          <div style="flex:1;min-width:180px"><label>Nombre</label><input name="name"></div><div style="width:110px"><label>Costo</label><input name="cost" inputmode="numeric"></div>
          <div style="width:140px"><label>Existencias</label><input name="stock" inputmode="numeric" placeholder="sin límite"></div><button class="btn btn-primary" type="submit">Agregar</button></form></details>
      <details style="margin-top:12px"><summary><b>Cambiar reglas (nueva versión con fecha)</b></summary>
        <form class="stack" data-version="${esc(p.id)}" style="margin-top:10px" novalidate>
          <div class="row"><div style="width:160px"><label>${p.kind === 'stamps' ? 'Sellos' : 'Puntos'} por compra</label><input name="pointsPerPurchase" inputmode="numeric" value="${v.points_per_purchase}"></div>
          <div style="width:160px"><label>Compra mínima ($)</label><input name="minPurchase" inputmode="decimal" value="${v.min_purchase_cents / 100}"></div>
          <div style="width:180px"><label>Vencen tras (días)</label><input name="expirationDays" inputmode="numeric" value="${v.expiration_days ?? ''}" placeholder="sin vencimiento"></div>
          <div style="width:180px"><label>Aplica desde</label><input name="effectiveFrom" type="date" value="${today}"></div></div>
          <div><label>Qué compras cuentan</label><input name="eligible" value="${esc(v.eligible_description)}"></div>
          <div><label>Condiciones</label><textarea name="terms">${esc(v.terms)}</textarea></div>
          <p class="small muted">Los puntos ya acumulados no se recalculan. Comunica el cambio a tus clientes antes de la fecha.</p>
          <button class="btn btn-primary" type="submit">Programar versión ${p.versions.length + 1}</button></form></details>
      <details style="margin-top:12px"><summary><b>Ajustes del programa</b></summary>
        <form class="row" data-settings="${esc(p.id)}" style="margin-top:10px;align-items:flex-end" novalidate>
          <div><label>Verificar titular al canjear</label><select name="redeemVerification"><option value="none" ${p.redeem_verification === 'none' ? 'selected' : ''}>No</option><option value="otp" ${p.redeem_verification === 'otp' ? 'selected' : ''}>Sí, con código al cliente</option></select></div>
          <div style="width:200px"><label>Máximo de compras por tarjeta al día</label><input name="maxPurchasesPerDay" inputmode="numeric" value="${p.max_purchases_per_card_per_day}"></div>
          <div><label>Estado</label><select name="status"><option value="active" ${p.status === 'active' ? 'selected' : ''}>Activo</option><option value="paused" ${p.status === 'paused' ? 'selected' : ''}>En pausa</option></select></div>
          <button class="btn btn-primary" type="submit">Guardar</button></form></details>` : '<p class="small muted">Las reglas y los premios los cambia el dueño. Como encargado puedes actualizar existencias.</p>'}
    </article>`;
  }).join('');
  const msg = (pid) => $(`[data-pmsg="${pid}"]`) ?? box;
  const patchReward = async (id, body, pid) => {
    try { const r = await api(`/api/owner/rewards/${id}`, { method: 'PATCH', body }); await loaders.programa(); showStatus(box.querySelector('[data-pmsg]'), 'ok', r.message); } catch (e) { showStatus(msg(pid), 'err', e.message); }
  };
  $$('[data-stock]').forEach((b) => b.addEventListener('click', () => { const s = prompt('Existencias disponibles (vacío = sin límite):'); if (s === null) return; patchReward(b.dataset.stock, { stock: s === '' ? null : Number(s) }); }));
  $$('[data-cost]').forEach((b) => b.addEventListener('click', () => { const s = prompt(`Nuevo costo (actual ${b.dataset.current}):`); if (!s) return; patchReward(b.dataset.cost, { cost: Number(s) }); }));
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => patchReward(b.dataset.toggle, { active: b.dataset.active !== 'true' })));
  $$('[data-addreward]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault(); const d = formData(f);
    try { await api(`/api/owner/programs/${f.dataset.addreward}/rewards`, { method: 'POST', body: { ...d, stock: d.stock === '' ? null : d.stock } }); await loaders.programa(); } catch (err) { showStatus(msg(f.dataset.addreward), 'err', err.message); }
  }));
  $$('[data-version]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault(); const d = formData(f);
    const ok = await confirmDialog({ title: 'Programar nuevas reglas', body: `Desde ${d.effectiveFrom} cada compra sumará ${d.pointsPerPurchase}. Los saldos actuales se respetan. ¿Continuar?`, confirmText: 'Programar' });
    if (!ok) return;
    try { const r = await api(`/api/owner/programs/${f.dataset.version}/versions`, { method: 'POST', body: { ...d, expirationDays: d.expirationDays === '' ? null : d.expirationDays, effectiveFrom: new Date(d.effectiveFrom + 'T00:00:00-06:00').toISOString() } }); await loaders.programa(); showStatus(box.querySelector('[data-pmsg]'), 'ok', r.message); } catch (err) { showStatus(msg(f.dataset.version), 'err', err.message); }
  }));
  $$('[data-settings]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api(`/api/owner/programs/${f.dataset.settings}`, { method: 'PATCH', body: formData(f) }); await loaders.programa(); showStatus(box.querySelector('[data-pmsg]'), 'ok', r.message); } catch (err) { showStatus(msg(f.dataset.settings), 'err', err.message); }
  }));
});

// ---------- Sucursales ----------
wrapLoad('sucursales', async (box) => {
  const [comp, { programs }, { categories }] = await Promise.all([api('/api/owner/company'), api('/api/owner/programs'), api('/api/public/categories')]);
  const leaves = [];
  const walk = (ns, path) => ns.forEach((n) => (n.children.length ? walk(n.children, [...path, n.name]) : leaves.push({ id: n.id, label: [...path, n.name].join(' › ') })));
  walk(categories, []);
  box.innerHTML = `
    <div class="results">${comp.branches.map((b) => `<article class="result" style="--card:${esc(comp.company.card_color)}"><span class="swatch"></span>
      <div><h3>${esc(b.name)}</h3><div class="addr">${esc([b.street, b.neighborhood].filter(Boolean).join(', '))}, ${esc(b.city)}</div>
      <div class="small muted">${esc(b.category)} · Programa: ${esc(programs.find((p) => p.id === b.program_id)?.name ?? 'sin programa')} · Código <span class="mono">${esc(b.code)}</span></div></div>
      <div class="result-actions"><a class="btn btn-primary btn-sm" href="/imprimir/qr/${esc(b.code)}" target="_blank">Imprimir QR de mostrador</a><a class="btn btn-secondary btn-sm" href="/s/${esc(b.code)}" target="_blank">Ver página</a></div></article>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">El QR del mostrador abre el registro de esa sucursal. No identifica clientes ni suma puntos.</p>
    ${isOwner() ? `<form class="panel" id="addBranch" style="margin-top:20px" novalidate><h3>Agregar sucursal</h3>
      <div class="row"><div style="flex:1;min-width:200px"><label>Nombre</label><input name="name" placeholder="Sucursal Sur"></div><div style="flex:2;min-width:240px"><label>Calle y número</label><input name="street"></div></div>
      <div class="row" style="margin-top:8px"><div style="flex:1;min-width:160px"><label>Colonia</label><input name="neighborhood"></div><div style="flex:1;min-width:160px"><label>Ciudad</label><input name="city"></div><div style="width:140px"><label>C.P.</label><input name="postalCode"></div></div>
      <div class="row" style="margin-top:8px"><div style="flex:1;min-width:220px"><label>Subcategoría</label><select name="categoryId">${leaves.map((l) => `<option value="${l.id}">${esc(l.label)}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:220px"><label>Programa</label><select name="programId">${programs.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.branches.length > 0 ? 'compartir saldo con ' + p.branches.map((x) => x.name).join(', ') : 'nuevo'})</option>`).join('')}</select></div></div>
      <div class="row" style="margin-top:8px"><div style="flex:1;min-width:200px"><label>Horario (opcional)</label><input name="hours"></div><div style="width:180px"><label>Teléfono (opcional)</label><input name="phone"></div></div>
      <div id="bmsg" style="margin-top:10px"></div><button class="btn btn-primary" type="submit" style="margin-top:10px">Crear sucursal</button></form>` : ''}`;
  $('#addBranch')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/api/owner/branches', { method: 'POST', body: formData(e.target) }); await loaders.sucursales(); box.insertAdjacentHTML('afterbegin', statusHtml('ok', 'Sucursal creada', r.message)); } catch (err) { showStatus($('#bmsg'), 'err', err.message); }
  });
});

// ---------- Perfil ----------
wrapLoad('perfil', async (box) => {
  const { company, subscription } = await api('/api/owner/company');
  box.innerHTML = `<div class="grid-2"><form class="panel" id="prof" novalidate><h2>Perfil del negocio</h2>
      <div class="field"><label>Descripción</label><textarea name="description" ${isOwner() ? '' : 'disabled'}>${esc(company.description ?? '')}</textarea></div>
      <div class="row"><div><label for="ccol">Color de la tarjeta</label><input id="ccol" name="cardColor" type="color" value="${esc(company.card_color)}" ${isOwner() ? '' : 'disabled'}></div>
      <div style="flex:1;min-width:220px"><label>Logotipo (URL, opcional)</label><input name="logoUrl" type="url" value="${esc(company.logo_url ?? '')}" ${isOwner() ? '' : 'disabled'}></div></div>
      <div class="field" style="margin-top:8px"><label>Teléfono de contacto</label><input name="contactPhone" value="${esc(company.contact_phone ?? '')}" ${isOwner() ? '' : 'disabled'}></div>
      <p class="small muted">La subida de archivos de logotipo está pendiente; por ahora se usa una dirección web.</p>
      <div id="prmsg"></div>${isOwner() ? '<button class="btn btn-primary" type="submit">Guardar</button>' : ''}</form>
    <div class="stack"><div id="preview"></div>
      <div class="panel"><h3>Suscripción</h3><p>Plan <b>${esc(subscription?.plan ?? '—')}</b> · ${esc(subscription?.status ?? '—')} · ${subscription?.monthly_price_cents ? fmtMoney(subscription.monthly_price_cents) + ' al mes' : ''}${subscription?.paid_through ? ` · pagado hasta ${fmtDate(subscription.paid_through)}` : ''}</p>
      <p class="small muted">Los pagos se registran manualmente por la administración durante el piloto.</p></div></div></div>`;
  const prev = () => { $('#preview').innerHTML = cardHtml({ company: company.name, program: 'Vista previa', balance: 30, kind: 'points', code: 'C-DEMO', color: $('#ccol').value, rewards: [{ cost: 50 }] }); };
  $('#ccol').addEventListener('input', prev);
  prev();
  $('#prof').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/api/owner/company', { method: 'PATCH', body: formData(e.target) }); showStatus($('#prmsg'), 'ok', r.message); me.company.cardColor = $('#ccol').value; } catch (err) { showStatus($('#prmsg'), 'err', err.message); }
  });
});

// ---------- Contingencia ----------
wrapLoad('contingencia', async (box) => {
  const { records } = await api('/api/owner/contingency');
  const ST = { pending: ['Pendiente', 'tag-pend'], applied: ['Aplicado', 'tag-ok'], duplicate: ['Duplicado', 'tag-bad'], rejected: ['Rechazado', 'tag-bad'] };
  box.innerHTML = `<p class="muted">Comprobantes anotados sin conexión. Revisa el ticket antes de aplicar; un ticket ya registrado se marca como duplicado y no suma.</p>
    ${records.length ? `<div class="table-wrap"><table><thead><tr><th>Ocurrió</th><th>Sucursal</th><th>Tarjeta</th><th>Ticket</th><th class="num">Importe</th><th>Capturó</th><th>Estado</th><th></th></tr></thead><tbody>${records.map((r) => `
      <tr><td>${fmtDateTime(r.occurred_at)}</td><td>${esc(r.branch)}</td><td class="mono">${esc(r.card_code)}</td><td>${esc(r.ticket_ref)}</td><td class="num">${fmtMoney(r.amount_cents)}</td><td>${esc(r.captured_by_name)}</td>
      <td><span class="tag ${ST[r.status][1]}">${ST[r.status][0]}</span>${r.note ? `<br><span class="small muted">${esc(r.note)}</span>` : ''}</td>
      <td>${r.status === 'pending' ? `<button class="btn btn-primary btn-sm" data-apply="${esc(r.id)}" type="button">Aplicar</button> <button class="btn btn-danger btn-sm" data-reject="${esc(r.id)}" type="button">Rechazar</button>` : ''}</td></tr>`).join('')}</tbody></table></div><div id="cmsg" style="margin-top:10px"></div>`
      : '<div class="panel empty"><p>No hay comprobantes de contingencia.</p></div>'}`;
  $$('[data-apply]').forEach((b) => b.addEventListener('click', async () => {
    try { const r = await api(`/api/owner/contingency/${b.dataset.apply}`, { method: 'POST', body: { decision: 'apply' } }); await loaders.contingencia(); showStatus($('#cmsg') ?? box, r.status === 'applied' ? 'ok' : 'warn', r.status === 'applied' ? 'Aplicado' : 'No se aplicó', r.message ?? ''); } catch (e) { showStatus($('#cmsg'), 'err', e.message); }
  }));
  $$('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt('Motivo del rechazo:'); if (!note) return;
    try { await api(`/api/owner/contingency/${b.dataset.reject}`, { method: 'POST', body: { decision: 'reject', note } }); await loaders.contingencia(); } catch (e) { showStatus($('#cmsg'), 'err', e.message); }
  }));
});

// ---------- Bitácora ----------
wrapLoad('bitacora', async (box) => {
  const { audit } = await api('/api/owner/audit');
  box.innerHTML = `<p class="muted">Registro de quién hizo qué y cuándo. No se puede editar ni borrar.</p>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>${audit.map((a) => `
      <tr><td>${fmtDateTime(a.created_at)}</td><td>${esc(a.actor ?? a.actor_kind)}</td><td class="mono small">${esc(a.action)}</td><td class="small">${esc(a.entity_id ?? '')} ${a.details ? `<span class="muted">${esc(JSON.stringify(a.details)).slice(0, 160)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
});

// ---------- Soporte ----------
wrapLoad('soporte', async (box) => {
  const { incidents } = await api('/api/owner/incidents');
  box.innerHTML = `<div class="grid-2"><form class="panel" id="inc" novalidate><h2>Pedir ayuda</h2>
      <p class="small muted">Soporte atiende en el horario publicado. No hay atención 24/7. Las caídas y canjes bloqueados se atienden antes que los cambios de diseño.</p>
      <div class="field"><label>Tipo</label><select name="kind"><option value="falla">No puedo registrar compras o canjes</option><option value="soporte">Duda de uso o configuración</option><option value="seguridad">Posible acceso indebido</option><option value="datos">Solicitud de datos de un cliente</option></select></div>
      <div class="field"><label>Título</label><input name="title"></div><div class="field"><label>Descripción</label><textarea name="description"></textarea></div>
      <div id="imsg"></div><button class="btn btn-primary" type="submit">Enviar</button></form>
    <div><h2>Mis solicitudes</h2>${incidents.length ? incidents.map((i) => `<div class="panel" style="margin-bottom:10px"><div class="row between"><b>${esc(i.title)}</b><span class="tag ${i.status === 'resuelto' ? 'tag-ok' : 'tag-pend'}">${esc(i.status)}</span></div><p class="small muted" style="margin:4px 0 0">${fmtDateTime(i.created_at)} · prioridad ${esc(i.priority)}${i.resolution ? ' · ' + esc(i.resolution) : ''}</p></div>`).join('') : '<p class="muted">Sin solicitudes.</p>'}</div></div>`;
  $('#inc').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/api/owner/incidents', { method: 'POST', body: formData(e.target) }); await loaders.soporte(); box.insertAdjacentHTML('afterbegin', statusHtml('ok', 'Solicitud enviada', r.message)); } catch (err) { showStatus($('#imsg'), 'err', err.message); }
  });
});

init();
